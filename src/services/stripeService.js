import Stripe from "stripe";
import { env } from "../config/env.js";
import { createId, query, withTransaction } from "../data/db.js";
import { addWalletBalance, getUserWallet } from "./coreService.js";
import { badRequest, notFound } from "../utils/httpError.js";

const stripe = new Stripe(env.stripeSecretKey);

/**
 * Crée une Stripe Checkout Session pour déposer des fonds.
 * Retourne l'URL de paiement vers laquelle rediriger le frontend.
 */
export async function createDepositSession(userId, amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 1) throw badRequest("Minimum deposit is $1");

  const amountCents = Math.round(value * 100);
  const orderId = createId("pay");

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: "AuronX Wallet Deposit",
            description: `Deposit $${value.toFixed(2)} to your trading wallet`,
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${env.frontendOrigin}/wallet?deposit=success&order_id=${orderId}`,
    cancel_url: `${env.frontendOrigin}/wallet?deposit=cancelled`,
    metadata: {
      orderId,
      userId,
    },
  });

  await query(
    `INSERT INTO payment_orders (id, user_id, amount, currency, status, stripe_session_id, created_at)
     VALUES ($1, $2, $3, 'usd', 'PENDING', $4, NOW())`,
    [orderId, userId, value, session.id]
  );

  return {
    orderId,
    sessionId: session.id,
    url: session.url, // frontend redirige vers cette URL
  };
}

/**
 * Vérifie la signature Stripe et crédite le wallet.
 * Appelé uniquement depuis le webhook (jamais depuis le frontend).
 */
export async function handleStripeWebhook(rawBody, signature) {
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
  } catch {
    throw badRequest("Invalid Stripe webhook signature");
  }

  if (event.type !== "checkout.session.completed") {
    return { received: true }; // ignorer les autres events
  }

  const session = event.data.object;
  const { orderId, userId } = session.metadata;

  await withTransaction(async (client) => {
    // Vérifier que l'ordre n'a pas déjà été traité (idempotence)
    const { rows } = await client.query(
      "SELECT * FROM payment_orders WHERE id = $1 FOR UPDATE",
      [orderId]
    );
    const order = rows[0];
    if (!order) throw notFound("Payment order not found");
    if (order.status === "SUCCESS") return; // déjà traité

    // Créditer le wallet
    const wallet = await getUserWallet(userId);
    await addWalletBalance(client, wallet.id, Number(order.amount), "PAYMENT_GATEWAY_DEPOSIT", orderId);

    // Marquer l'ordre comme traité
    await client.query(
      "UPDATE payment_orders SET status = 'SUCCESS' WHERE id = $1",
      [orderId]
    );
  });

  return { received: true };
}
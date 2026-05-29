import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing stripe-signature header", { status: 400 });
  if (!webhookSecret) return new Response("Webhook secret not configured", { status: 500 });

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error("Signature verification failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`Bad signature: ${msg}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id;
    if (!userId) {
      console.warn("checkout.session.completed missing client_reference_id", session.id);
      return new Response(JSON.stringify({ ignored: "no client_reference_id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    const { error } = await supabase
      .from("profiles")
      .update({
        tier: "pro",
        stripe_customer_id: customerId,
        stripe_payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) {
      console.error("Profile upgrade failed:", userId, error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Upgraded profile to Pro: user_id=${userId}, pi=${paymentIntentId}`);
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id ?? null;
    if (!paymentIntentId) {
      console.warn("charge.refunded without payment_intent", charge.id);
      return new Response("ok", { status: 200 });
    }

    // Look up the profile that paid via this payment_intent and revoke Pro.
    // If no row matches (e.g. our test purchase that pre-dates the column),
    // we silently no-op so legacy/manual upgrades aren't disturbed.
    const { data, error } = await supabase
      .from("profiles")
      .update({
        tier: "free",
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_payment_intent_id", paymentIntentId)
      .select("user_id");

    if (error) {
      console.error("Refund downgrade failed:", paymentIntentId, error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!data || data.length === 0) {
      console.log(`Refund for ${paymentIntentId} — no matching profile, skipping downgrade`);
    } else {
      console.log(`Refund downgrade: user_id=${data[0].user_id}, pi=${paymentIntentId}`);
    }
  }

  return new Response("ok", { status: 200 });
});

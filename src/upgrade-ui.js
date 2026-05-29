/**
 * "Upgrade to Pro" CTA + Stripe checkout flow.
 *
 * Click → opens the Stripe Payment Link in a new tab, with the signed-in user's
 * Supabase user_id passed as client_reference_id so the webhook can match the
 * buyer back to their profile. When the user returns to the tab, we re-fetch
 * their tier (manual button + visibilitychange listener) and show success once
 * the webhook flips them to Pro.
 */
import { currentUser } from './cloud.js';
import { onTierChange, refreshTier } from './tiers.js';
import { toast } from './toasts.js';

// Live-mode Stripe Payment Link for Fasty Pro (€9 one-time lifetime).
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/dRm28qbHh91uftC67c0kE00';

export function initUpgradeUI() {
  const cta = document.getElementById('open-upgrade');
  const backdrop = document.getElementById('upgrade-backdrop');
  const closeBtn = document.getElementById('upgrade-close');
  const buyBtn = document.getElementById('upgrade-buy');
  const waiting = document.getElementById('upgrade-waiting');
  const refreshBtn = document.getElementById('upgrade-refresh');
  const success = document.getElementById('upgrade-success');
  if (!cta || !backdrop || !buyBtn) return;

  const resetModalState = () => {
    buyBtn.hidden = false;
    waiting.hidden = true;
    success.hidden = true;
  };

  onTierChange((tier) => {
    cta.hidden = tier === 'pro';
    if (tier === 'pro' && !backdrop.hidden) {
      buyBtn.hidden = true;
      waiting.hidden = true;
      success.hidden = false;
    }
  });

  cta.addEventListener('click', () => {
    resetModalState();
    backdrop.hidden = false;
  });

  closeBtn.addEventListener('click', () => { backdrop.hidden = true; });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.hidden = true;
  });

  buyBtn.addEventListener('click', () => {
    const user = currentUser();
    if (!user) {
      toast('Please sign in to upgrade.', { error: true });
      return;
    }
    const params = new URLSearchParams({
      client_reference_id: user.id,
      prefilled_email: user.email || '',
    });
    window.open(`${STRIPE_PAYMENT_LINK}?${params.toString()}`, '_blank', 'noopener,noreferrer');
    buyBtn.hidden = true;
    waiting.hidden = false;
  });

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    const originalLabel = refreshBtn.textContent;
    refreshBtn.textContent = 'Checking…';
    try {
      const tier = await refreshTier();
      if (tier !== 'pro') {
        toast("Payment isn't reflected yet — give it a few seconds and try again.", { duration: 5000 });
      }
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = originalLabel;
    }
  });

  // Auto-refresh tier when the user comes back to this tab from Stripe.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !backdrop.hidden && !waiting.hidden) {
      refreshTier().catch(() => {});
    }
  });
}

/**
 * "Upgrade to Pro" CTA + waitlist capture. Until Pro payments ship, the modal
 * collects emails into public.waitlist for launch notifications.
 */
import { joinWaitlist, currentUser } from './cloud.js';
import { onTierChange } from './tiers.js';
import { toast } from './toasts.js';

export function initUpgradeUI() {
  const cta = document.getElementById('open-upgrade');
  const backdrop = document.getElementById('upgrade-backdrop');
  const closeBtn = document.getElementById('upgrade-close');
  const form = document.getElementById('upgrade-form');
  const emailInput = document.getElementById('upgrade-email');
  const thanks = document.getElementById('upgrade-thanks');
  if (!cta || !backdrop || !form) return;

  onTierChange((tier) => { cta.hidden = tier === 'pro'; });

  cta.addEventListener('click', () => {
    backdrop.hidden = false;
    thanks.hidden = true;
    form.hidden = false;
    const user = currentUser();
    if (user?.email) emailInput.value = user.email;
    setTimeout(() => emailInput.focus(), 0);
  });

  closeBtn.addEventListener('click', () => { backdrop.hidden = true; });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.hidden = true;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;
    try {
      await joinWaitlist(email, 'upgrade_button');
      form.hidden = true;
      thanks.hidden = false;
    } catch (err) {
      toast(`Couldn't sign you up: ${err.message}`, { error: true });
    }
  });
}

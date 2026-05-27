/**
 * First-time-sign-in onboarding modal: ask for display name + country + leaderboard opt-in.
 * Skip = full opt-out (display_name stays null, leaderboard_optin = false).
 */
import { getProfile, updateProfile } from './cloud.js';
import { detectCountryCode } from './timezone-country.js';
import { toast } from './toasts.js';

const COUNTRIES = [
  ['NL','Netherlands'],['BE','Belgium'],['FR','France'],['ES','Spain'],['IT','Italy'],
  ['DE','Germany'],['GB','United Kingdom'],['IE','Ireland'],['PT','Portugal'],['CH','Switzerland'],
  ['AT','Austria'],['PL','Poland'],['CZ','Czechia'],['SE','Sweden'],['NO','Norway'],
  ['DK','Denmark'],['FI','Finland'],['GR','Greece'],['US','United States'],['CA','Canada'],
  ['MX','Mexico'],['BR','Brazil'],['AR','Argentina'],['JP','Japan'],['CN','China'],
  ['IN','India'],['SG','Singapore'],['KR','South Korea'],['AU','Australia'],['NZ','New Zealand'],
  ['ZA','South Africa'],['EG','Egypt'],['NG','Nigeria'],['MA','Morocco'],['IL','Israel'],
];

export async function maybeShowOnboarding() {
  let profile;
  try { profile = await getProfile(); } catch { return; }
  if (!profile) return;
  if (profile.displayName) return; // already onboarded

  const backdrop = document.getElementById('onboarding-backdrop');
  if (!backdrop) return;

  const select = backdrop.querySelector('#onb-country');
  select.innerHTML = '<option value="">(choose a country)</option>' +
    COUNTRIES.map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
  const detected = profile.countryCode || detectCountryCode();
  if (detected) select.value = detected;

  backdrop.hidden = false;

  return new Promise(resolve => {
    const form = backdrop.querySelector('#onboarding-form');
    const skipBtn = backdrop.querySelector('#onb-skip');

    const cleanup = () => {
      backdrop.hidden = true;
      form.removeEventListener('submit', onSubmit);
      skipBtn.removeEventListener('click', onSkip);
    };

    const onSubmit = async (e) => {
      e.preventDefault();
      const name = backdrop.querySelector('#onb-name').value.trim() || null;
      const country = backdrop.querySelector('#onb-country').value || null;
      const optin = backdrop.querySelector('#onb-optin').checked;
      try {
        await updateProfile({ displayName: name, countryCode: country, leaderboardOptin: optin });
        toast('Profile saved.');
      } catch (err) {
        toast(`Couldn't save: ${err.message}`, { error: true });
        return;
      }
      cleanup();
      resolve();
    };

    const onSkip = async () => {
      try {
        await updateProfile({ displayName: null, countryCode: null, leaderboardOptin: false });
      } catch (_) {}
      cleanup();
      resolve();
    };

    form.addEventListener('submit', onSubmit);
    skipBtn.addEventListener('click', onSkip);
  });
}

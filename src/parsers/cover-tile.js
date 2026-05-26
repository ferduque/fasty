/**
 * Generate a 300x450 cover tile for documents without a real cover.
 * Returns a Promise<Blob>.
 */
export async function generateCoverTile(title) {
  const canvas = document.createElement('canvas');
  canvas.width = 300; canvas.height = 450;
  const ctx = canvas.getContext('2d');

  // Color hashed from title
  const hash = [...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  const hue = hash % 360;
  ctx.fillStyle = `hsl(${hue} 55% 35%)`;
  ctx.fillRect(0, 0, 300, 450);

  // Subtle gradient
  const g = ctx.createLinearGradient(0, 0, 300, 450);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 300, 450);

  // Title — first 1–3 words, wrap if needed
  const words = title.trim().split(/\s+/).slice(0, 3);
  ctx.fillStyle = 'white';
  ctx.font = '600 28px "Crimson Pro", Georgia, serif';
  ctx.textAlign = 'center';
  const startY = 225 - (words.length - 1) * 18;
  words.forEach((w, i) => ctx.fillText(w, 150, startY + i * 36));

  return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

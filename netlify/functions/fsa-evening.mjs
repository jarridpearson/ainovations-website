// Runs every evening: one email to her listing tomorrow's visits.
// The logic lives in fsa.mjs (action 'daily-run', kind 'evening').

export default async () => {
  const res = await fetch(`${process.env.URL || 'https://ainovations.net'}/api/fsa`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fsa-cron': process.env.FSA_SESSION_SECRET || '' },
    body: JSON.stringify({ action: 'daily-run', kind: 'evening' }),
  });
  console.log('fsa evening digest', res.status, await res.text());
};

// 22:00 UTC = 6:00 PM Eastern (5:00 PM in winter).
export const config = { schedule: '0 22 * * *' };

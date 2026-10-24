// Runs every morning: moves any visit that now falls on time off to the next
// open slot (emailing the customer), then charges today's repeat visits.
// The logic lives in fsa.mjs (action 'daily-run').

export default async () => {
  const res = await fetch(`${process.env.URL || 'https://ainovations.net'}/api/fsa`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fsa-cron': process.env.FSA_SESSION_SECRET || '' },
    body: JSON.stringify({ action: 'daily-run', kind: 'morning' }),
  });
  console.log('fsa daily run', res.status, await res.text());
};

// 11:00 UTC = 7:00 AM Eastern (6:00 AM in winter).
export const config = { schedule: '0 11 * * *' };

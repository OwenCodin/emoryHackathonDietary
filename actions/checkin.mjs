import { callPatient } from './outbound.mjs';

const phone = process.env.PATIENT_PHONE;
const reason = process.argv.slice(2).join(' ').trim() || 'Mealtime check-in';

if (!phone) {
  process.stderr.write('PATIENT_PHONE is required in .env.local\n');
  process.exitCode = 1;
} else {
  const result = await callPatient({ phone, reason });
  if (!result.ok) {
    process.stderr.write(`Mealtime call failed: ${result.error}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Chert accepted call ${result.callId}\n`);
  }
}

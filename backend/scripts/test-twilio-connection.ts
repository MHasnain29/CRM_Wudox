import '../src/loadEnv';
import prisma from '../src/config/database';
import { testAgencyTwilioConnection, getAgencyTwilioCredentials } from '../src/services/agencyTwilioService';

async function main() {
  const agencies = await prisma.subCompany.findMany({ select: { id: true, name: true } });
  for (const a of agencies) {
    console.log('\n---', a.name, a.id, '---');
    const creds = await getAgencyTwilioCredentials(a.id);
    console.log('configured:', Boolean(creds));
    if (creds) {
      console.log('accountSid:', creds.accountSid);
      console.log('apiKeySid:', creds.apiKeySid);
      console.log('twimlAppSid:', creds.twimlAppSid);
      console.log('authToken length:', creds.authToken?.length);
      console.log('apiKeySecret length:', creds.apiKeySecret?.length);
    }
    const result = await testAgencyTwilioConnection(a.id);
    console.log('test:', result);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

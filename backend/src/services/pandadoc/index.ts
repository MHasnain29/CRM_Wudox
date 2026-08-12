export * from './types';
export { pandaDocService, matchProposalToken, type ProposalPrefill } from './pandadocService';
export {
  sendPandaDocWithAgencyFrom,
  type PandaDocCrmDeliveryResult,
} from './pandaDocCrmDelivery';
// Do NOT re-export client.ts — routes should only touch the service layer.

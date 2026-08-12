import { Navigate } from 'react-router-dom';

/** Legacy route — production approval queues live under Clients → Pending. */
export default function Approvals() {
  return <Navigate to="/clients?tab=pending" replace />;
}

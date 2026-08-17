import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthGuard } from "./components/AuthGuard";
import { PermissionRoute } from "./components/PermissionRoute";
import { Layout } from "./components/Layout";
import { SnippingToolWidget } from "./components/SnippingToolWidget";
import { FloatingCallBubble } from "./components/FloatingCallBubble";
import { InboundCallRoot } from "./components/phone-system/InboundCallRoot";
import { MessageSoundListener } from "./components/MessageSoundListener";
import { InternalCallOverlay } from "./components/InternalCallOverlay";
import { CallDurationTimer } from "./components/CallDurationTimer";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import Leads from "./pages/Leads";
import Pipeline from "./pages/Pipeline";
import Calls from "./pages/Calls";
import Emails from "./pages/Emails";
import BulkEmails from "./pages/BulkEmails";
import Tasks from "./pages/Tasks";
import FollowUps from "./pages/FollowUps";
import Meetings from "./pages/Meetings";
import Messages from "./pages/Messages";
import Reports from "./pages/Reports";
import Approvals from "./pages/Approvals";
import Proposals from "./pages/Proposals";
import Settings from "./pages/Settings";
import Lists from "./pages/Lists";
import Users from "./pages/Users";
import SuperUsers from "./pages/SuperUsers";
import BugReports from "./pages/BugReports";
import BookingPage from "./pages/BookingPage";
import Calculators from "./pages/Calculators";
import Documents from "./pages/Documents";
import Employees from "./pages/Employees";
import EmployeeForm from "./pages/EmployeeForm";
import EmployeeJobMatches from "./pages/EmployeeJobMatches";
import Jobs from "./pages/Jobs";
import ActiveClients from "./pages/ActiveClients";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Leave from "./pages/Leave";
import LeaveAdmin from "./pages/LeaveAdmin";
import NotFound from "./pages/NotFound";
import { useEffect } from "react";
import { toast } from "sonner";

function AgencySwitchedToast() {
  useEffect(() => {
    try {
      const agencyName = sessionStorage.getItem('agency_switch_toast');
      if (agencyName) {
        sessionStorage.removeItem('agency_switch_toast');
        toast.success(`Switched to ${agencyName}`, { duration: 4000 });
      }
    } catch {
      // ignore
    }
  }, []);
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AgencySwitchedToast />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthGuard>
          <Routes>
            {/* Public routes — no Layout shell */}
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/book/:slug" element={<BookingPage />} />

            {/* Authenticated routes — Layout mounts ONCE, never remounts on navigation */}
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/clients" element={<PermissionRoute permission="clients:read"><Clients /></PermissionRoute>} />
              <Route path="/leads" element={<PermissionRoute permission="leads:read"><Leads /></PermissionRoute>} />
              <Route
                path="/pipeline"
                element={
                  <PermissionRoute permission="pipeline:read">
                    <Pipeline />
                  </PermissionRoute>
                }
              />
              <Route path="/lists" element={<PermissionRoute permission="calls:read"><Lists /></PermissionRoute>} />
              <Route path="/calls" element={<PermissionRoute permission="calls:read"><Calls /></PermissionRoute>} />
              <Route path="/emails" element={<PermissionRoute permission="calls:read"><Emails /></PermissionRoute>} />
              <Route path="/bulk-emails" element={<PermissionRoute permission="calls:read"><BulkEmails /></PermissionRoute>} />
              <Route path="/tasks" element={<PermissionRoute permission="tasks:read"><Tasks /></PermissionRoute>} />
              <Route path="/follow-ups" element={<PermissionRoute permission="tasks:read"><FollowUps /></PermissionRoute>} />
              <Route path="/meetings" element={<PermissionRoute permission="meetings:read"><Meetings /></PermissionRoute>} />
              <Route path="/messages" element={<PermissionRoute permission="users:read"><Messages /></PermissionRoute>} />
              <Route path="/reports" element={<PermissionRoute permission={['analytics:read', 'jobs:read']}><Reports /></PermissionRoute>} />
              <Route path="/approvals" element={<PermissionRoute permission="clients:approve"><Approvals /></PermissionRoute>} />
              <Route
                path="/proposals"
                element={
                  <PermissionRoute permission={['proposals:read', 'proposals:write', 'proposals:review']}>
                    <Proposals />
                  </PermissionRoute>
                }
              />
              <Route path="/settings" element={<PermissionRoute permission="settings:read"><Settings /></PermissionRoute>} />
              <Route
                path="/users"
                element={
                  <PermissionRoute permission="users:directory">
                    <Users />
                  </PermissionRoute>
                }
              />
              <Route
                path="/super-users"
                element={
                  <PermissionRoute permission={['agencies:global', 'agencies:cross_org']}>
                    <SuperUsers />
                  </PermissionRoute>
                }
              />
              <Route path="/bug-reports" element={<PermissionRoute permission="bug_reports:read"><BugReports /></PermissionRoute>} />
              <Route path="/calculators" element={<PermissionRoute permission="leads:read"><Calculators /></PermissionRoute>} />
              <Route
                path="/documents"
                element={
                  <PermissionRoute permission={['proposals:read', 'proposals:write', 'proposals:review']}>
                    <Documents />
                  </PermissionRoute>
                }
              />
              <Route path="/employees" element={<PermissionRoute permission="employees:read"><Employees /></PermissionRoute>} />
              <Route path="/employees/new" element={<PermissionRoute permission="employees:write"><EmployeeForm /></PermissionRoute>} />
              <Route path="/employees/:id/edit" element={<PermissionRoute permission="employees:write"><EmployeeForm /></PermissionRoute>} />
              <Route path="/employee-job-matches" element={<PermissionRoute permission="employees:read"><EmployeeJobMatches /></PermissionRoute>} />
              <Route path="/active-clients" element={<PermissionRoute permission="jobs:read"><ActiveClients /></PermissionRoute>} />
              <Route path="/jobs" element={<PermissionRoute permission="jobs:read"><Jobs /></PermissionRoute>} />
              <Route path="/projects" element={<PermissionRoute permission="projects:read"><Projects /></PermissionRoute>} />
              <Route path="/projects/:id" element={<PermissionRoute permission="projects:read"><ProjectDetail /></PermissionRoute>} />
              <Route path="/leave" element={<PermissionRoute permission="leave:read"><Leave /></PermissionRoute>} />
              <Route path="/leave/admin" element={<PermissionRoute permission="leave:approve"><LeaveAdmin /></PermissionRoute>} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          {/* Global call timer — never unmounts, keeps duration accurate even when minimized */}
          <CallDurationTimer />
          <InboundCallRoot />
          <FloatingCallBubble />
          <SnippingToolWidget />
          <MessageSoundListener />
          <InternalCallOverlay />
        </AuthGuard>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

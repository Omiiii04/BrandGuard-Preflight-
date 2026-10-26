import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { OrgProvider } from './context/OrgContext';
import RequireAuth from './components/layout/RequireAuth';

import LoginPage        from './pages/LoginPage';
import DashboardPage    from './pages/DashboardPage';
import KnowledgeBasePage from './pages/KnowledgeBasePage';
import DraftSubmitPage  from './pages/DraftSubmitPage';
import ReviewPage       from './pages/ReviewPage';
import WorkflowPage     from './pages/WorkflowPage';
import PassportPage     from './pages/PassportPage';
import ForbiddenPage    from './pages/ForbiddenPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <OrgProvider>
          <Routes>
            <Route path="/login"    element={<LoginPage />} />
            <Route path="/forbidden" element={<ForbiddenPage />} />

            <Route
              path="/dashboard"
              element={
                <RequireAuth allowedRoles={['creator', 'manager', 'owner', 'admin']}>
                  <DashboardPage />
                </RequireAuth>
              }
            />

            <Route
              path="/knowledge-base"
              element={
                <RequireAuth allowedRoles={['admin', 'owner', 'manager', 'creator']}>
                  <KnowledgeBasePage />
                </RequireAuth>
              }
            />

            <Route
              path="/drafts/new"
              element={
                <RequireAuth allowedRoles={['creator', 'admin']}>
                  <DraftSubmitPage />
                </RequireAuth>
              }
            />

            <Route
              path="/drafts"
              element={
                <RequireAuth allowedRoles={['creator', 'manager', 'admin']}>
                  <DashboardPage />
                </RequireAuth>
              }
            />

            <Route
              path="/drafts/:draftId/review"
              element={
                <RequireAuth allowedRoles={['creator', 'manager', 'admin', 'owner']}>
                  <ReviewPage />
                </RequireAuth>
              }
            />

            <Route
              path="/drafts/:draftId/workflow"
              element={
                <RequireAuth allowedRoles={['creator', 'manager', 'admin', 'owner']}>
                  <WorkflowPage />
                </RequireAuth>
              }
            />

            <Route
              path="/passports"
              element={
                <RequireAuth allowedRoles={['manager', 'admin', 'owner']}>
                  <PassportPage />
                </RequireAuth>
              }
            />

            <Route
              path="/passports/:passportId"
              element={
                <RequireAuth allowedRoles={['manager', 'admin', 'owner']}>
                  <PassportPage />
                </RequireAuth>
              }
            />

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </OrgProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

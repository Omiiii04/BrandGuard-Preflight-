import { Link } from 'react-router-dom';
import './LoginPage.css';

export default function ForbiddenPage() {
  return (
    <div className="login-page" role="main">
      <div className="login-card card" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--font-size-display)' }}>403</h1>
        <p>You do not have permission to view this page.</p>
        <Link to="/dashboard" className="btn btn-primary" style={{ justifyContent: 'center' }}>
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

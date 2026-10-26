import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function AppLayout({ children, pageTitle }) {
  return (
    <div className="app-layout">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <Sidebar />
      <div className="app-main">
        <TopBar pageTitle={pageTitle} />
        <main id="main-content" className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}

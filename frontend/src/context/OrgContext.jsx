import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const OrgContext = createContext(null);

export function OrgProvider({ children }) {
  const { user } = useAuth();
  const [org, setOrg] = useState(null);

  useEffect(() => {
    if (user) {
      setOrg({
        id:   user.orgId,
        name: user.orgName ?? 'My Organisation',
      });
    } else {
      setOrg(null);
    }
  }, [user]);

  return (
    <OrgContext.Provider value={{ org }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}

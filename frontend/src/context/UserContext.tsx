import { useState } from 'react';
import { UserContext } from './user-context';

const STORAGE_KEY = 'userName';

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [name, setNameState] = useState(() => localStorage.getItem(STORAGE_KEY) || '');

  const setName = (n: string) => {
    if (n) localStorage.setItem(STORAGE_KEY, n);
    else localStorage.removeItem(STORAGE_KEY);
    setNameState(n);
  };

  return (
    <UserContext.Provider value={{ name, setName }}>
      {children}
    </UserContext.Provider>
  );
}

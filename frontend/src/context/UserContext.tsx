import { createContext, useContext, useState } from 'react';

interface UserContextType {
  name: string;
  setName: (name: string) => void;
}

const UserContext = createContext<UserContextType>({ name: '', setName: () => {} });

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [name, setNameState] = useState(() => localStorage.getItem('userName') || '');

  const setName = (n: string) => {
    localStorage.setItem('userName', n);
    setNameState(n);
  };

  return (
    <UserContext.Provider value={{ name, setName }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}

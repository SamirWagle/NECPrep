import { createContext, useContext } from 'react';

export interface UserContextType {
  name: string;
  setName: (name: string) => void;
}

export const UserContext = createContext<UserContextType>({
  name: '',
  setName: () => {},
});

export function useUser() {
  return useContext(UserContext);
}

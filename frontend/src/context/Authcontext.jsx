import React, { createContext, useCallback, useContext, useState, useEffect } from 'react';
import { authApi } from '../service/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [auth, setAuth] = useState({
        isAuthenticated: false,
        user: {
            id: '',
            role: '',
            wallet: 0,
            // A reseller is a customer account with a reseller profile. This is
            // only a navigation hint; the backend re-checks it on every call.
            isReseller: false,
            referralCode: null,
        },
        isLoading: true, // Start with loading true
    });

    const refreshAuth = useCallback(async () => {
        try {
            const data = await authApi.me();
            if (data.success && data.data.isAuthenticated) {
                const res = data.data.user;
                setAuth({
                    isAuthenticated: true,
                    user: {
                        id: res.id,
                        role: res.role,
                        wallet: res.wallet,
                        isReseller: Boolean(res.isReseller),
                        referralCode: res.referralCode || null,
                    },
                    isLoading: false,
                });
                return true;
            }
        } catch (error) {
            console.log('Auth check failed:', error);
        }
        setAuth({
            isAuthenticated: false,
            user: { id: '', role: '', wallet: 0, isReseller: false, referralCode: null },
            isLoading: false,
        });
        return false;
    }, []);

    useEffect(() => { refreshAuth(); }, [refreshAuth]);

    const login = (id, role, wallet, extras = {}) => {
        setAuth({
            isAuthenticated: true,
            user: {
                id,
                role,
                wallet,
                isReseller: Boolean(extras.isReseller),
                referralCode: extras.referralCode || null,
            },
            isLoading: false,
        });
    };

    const logout = async () => {
        try {
            // Call the logout API to clear the server-side session
            await authApi.logout();
        } catch (error) {
            console.error('Logout API error:', error);
            // Continue with logout even if API call fails
        }
        
        // Update local state
        setAuth({
            isAuthenticated: false,
            user: { id: '', role: '', wallet: 0, isReseller: false, referralCode: null },
            isLoading: false,
        });
    };

    return (
        <AuthContext.Provider value={{ ...auth, login, logout, refreshAuth }}>
            {children}
        </AuthContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

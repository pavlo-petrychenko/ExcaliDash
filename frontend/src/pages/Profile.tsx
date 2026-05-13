import React, { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { Collection } from '../types';
import { User, Lock, Save, X, KeyRound, Copy, Trash2 } from 'lucide-react';
import { USER_KEY } from '../utils/impersonation';
import { getPasswordPolicy, validatePassword } from '../utils/passwordPolicy';
import { PasswordRequirements } from '../components/PasswordRequirements';

const getApiErrorMessage = (err: unknown, fallback: string) => {
    if (api.isAxiosError(err)) {
        if (err.response?.data?.message) {
            return err.response.data.message;
        }
        if (err.response?.data?.error) {
            return err.response.data.error;
        }
    }
    return fallback;
};

const formatApiKeyDate = (value: string | null) => {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
};

export const Profile: React.FC = () => {
    const { user: authUser, logout, authEnabled } = useAuth();
    const navigate = useNavigate();
    const mustResetPassword = Boolean(authUser?.mustResetPassword);
    const passwordPolicy = getPasswordPolicy();
    const [collections, setCollections] = useState<Collection[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [showEmailForm, setShowEmailForm] = useState(false);
    const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
    const [emailLoading, setEmailLoading] = useState(false);

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPasswordForm, setShowPasswordForm] = useState(false);

    const [apiKeys, setApiKeys] = useState<api.ApiKeyMetadata[]>([]);
    const [apiKeysLoading, setApiKeysLoading] = useState(false);
    const [apiKeyName, setApiKeyName] = useState('');
    const [apiKeyActionLoading, setApiKeyActionLoading] = useState(false);
    const [apiKeyError, setApiKeyError] = useState('');
    const [generatedToken, setGeneratedToken] = useState('');
    const [generatedTokenName, setGeneratedTokenName] = useState('');
    const [copiedToken, setCopiedToken] = useState(false);

    useEffect(() => {
        if (authEnabled === false) {
            navigate('/settings', { replace: true });
            return;
        }
        const fetchData = async () => {
            try {
                const collectionsData = await api.getCollections();
                setCollections(collectionsData);
                
                if (authUser) {
                    setName(authUser.name);
                    setEmail(authUser.email);
                }
            } catch (err) {
                console.error('Failed to fetch data:', err);
            }
        };
        fetchData();
    }, [authEnabled, authUser, navigate]);

    useEffect(() => {
        if (authEnabled === false) return;
        if (mustResetPassword) {
            setApiKeys([]);
            setApiKeysLoading(false);
            setApiKeyError('');
            return;
        }

        const fetchApiKeys = async () => {
            setApiKeysLoading(true);
            setApiKeyError('');
            try {
                setApiKeys(await api.listApiKeys());
            } catch (err: unknown) {
                setApiKeyError(getApiErrorMessage(err, 'Failed to load API keys'));
            } finally {
                setApiKeysLoading(false);
            }
        };

        void fetchApiKeys();
    }, [authEnabled, mustResetPassword]);

    useEffect(() => {
        if (mustResetPassword) {
            setShowPasswordForm(true);
        }
    }, [mustResetPassword]);

    const handleSelectCollection = (id: string | null | undefined) => {
        if (id === undefined) navigate('/');
        else if (id === null) navigate('/collections?id=unorganized');
        else navigate(`/collections?id=${id}`);
    };

    const handleCreateCollection = async (name: string) => {
        await api.createCollection(name);
        const newCollections = await api.getCollections();
        setCollections(newCollections);
    };

    const handleEditCollection = async (id: string, name: string) => {
        setCollections(prev => prev.map(c => c.id === id ? { ...c, name } : c));
        await api.updateCollection(id, name);
    };

    const handleDeleteCollection = async (id: string) => {
        setCollections(prev => prev.filter(c => c.id !== id));
        await api.deleteCollection(id);
    };

    const handleUpdateName = async () => {
        if (mustResetPassword) {
            setError('You must reset your password before updating your profile');
            return;
        }
        if (!name.trim()) {
            setError('Name cannot be empty');
            return;
        }

        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const response = await api.api.put<{ user: { id: string; email: string; name: string; createdAt: string; updatedAt: string } }>('/auth/profile', { name: name.trim() });
            setSuccess('Name updated successfully');
            if (response.data?.user) {
                localStorage.setItem('excalidash-user', JSON.stringify(response.data.user));
                setTimeout(() => window.location.reload(), 500);
            }
        } catch (err: unknown) {
            let message = 'Failed to update name';
            if (api.isAxiosError(err)) {
                if (err.response?.data?.message) {
                    message = err.response.data.message;
                } else if (err.response?.data?.error) {
                    message = err.response.data.error;
                }
            }
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const handleChangePassword = async () => {
        if (!currentPassword || !newPassword || !confirmPassword) {
            setError('All password fields are required');
            return;
        }

        const passwordError = validatePassword(newPassword, passwordPolicy);
        if (passwordError) {
            setError(passwordError);
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('New passwords do not match');
            return;
        }

        setLoading(true);
        setError('');
        setSuccess('');

        try {
            await api.api.post('/auth/change-password', {
                currentPassword,
                newPassword,
            });
            setSuccess('Password changed successfully');
            setShowPasswordForm(false);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setTimeout(() => {
                logout();
                navigate('/login');
            }, 2000);
        } catch (err: unknown) {
            let message = 'Failed to change password';
            if (api.isAxiosError(err)) {
                if (err.response?.data?.message) {
                    message = err.response.data.message;
                } else if (err.response?.data?.error) {
                    message = err.response.data.error;
                }
            }
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateEmail = async () => {
        if (mustResetPassword) {
            setError('You must reset your password before changing your email');
            return;
        }
        if (!email.trim()) {
            setError('Email cannot be empty');
            return;
        }
        if (!emailCurrentPassword) {
            setError('Current password is required to change email');
            return;
        }

        setEmailLoading(true);
        setError('');
        setSuccess('');

        try {
            const response = await api.api.put<{
                user: { id: string; email: string; name: string; createdAt: string; updatedAt: string };
            }>('/auth/email', {
                email: email.trim(),
                currentPassword: emailCurrentPassword,
            });

            localStorage.setItem(USER_KEY, JSON.stringify(response.data.user));

            setSuccess('Email updated successfully');
            setShowEmailForm(false);
            setEmailCurrentPassword('');

            setTimeout(() => window.location.reload(), 500);
        } catch (err: unknown) {
            let message = 'Failed to update email';
            if (api.isAxiosError(err)) {
                if (err.response?.data?.message) {
                    message = err.response.data.message;
                } else if (err.response?.data?.error) {
                    message = err.response.data.error;
                }
            }
            setError(message);
        } finally {
            setEmailLoading(false);
        }
    };

    const handleCreateApiKey = async () => {
        if (mustResetPassword || apiKeysLoading) return;

        const trimmedName = apiKeyName.trim();
        if (!trimmedName) {
            setApiKeyError('API key name is required');
            return;
        }

        setApiKeyActionLoading(true);
        setApiKeyError('');
        setSuccess('');
        setGeneratedToken('');
        setGeneratedTokenName('');
        setCopiedToken(false);

        try {
            const response = await api.createApiKey(trimmedName);
            setApiKeys(prev => [response.apiKey, ...prev]);
            setApiKeyName('');
            setGeneratedToken(response.token);
            setGeneratedTokenName(response.apiKey.name);
            setSuccess('API key created. Copy the token now; it will not be shown again.');
        } catch (err: unknown) {
            setApiKeyError(getApiErrorMessage(err, 'Failed to create API key'));
        } finally {
            setApiKeyActionLoading(false);
        }
    };

    const handleCopyGeneratedToken = async () => {
        if (!generatedToken) return;

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(generatedToken);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = generatedToken;
                textarea.setAttribute('readonly', 'true');
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            setCopiedToken(true);
            setSuccess('API key token copied to clipboard');
            window.setTimeout(() => setCopiedToken(false), 1500);
        } catch {
            setApiKeyError('Failed to copy token. Select and copy it manually.');
        }
    };

    const handleHideGeneratedToken = () => {
        setGeneratedToken('');
        setGeneratedTokenName('');
        setCopiedToken(false);
    };

    const handleRevokeApiKey = async (id: string, name: string) => {
        const confirmed = window.confirm(`Revoke API key "${name}"? Existing integrations using this key will stop working.`);
        if (!confirmed) return;

        setApiKeyActionLoading(true);
        setApiKeyError('');
        setSuccess('');

        try {
            await api.revokeApiKey(id);
            const revokedAt = new Date().toISOString();
            setApiKeys(prev => prev.map(apiKey => apiKey.id === id ? { ...apiKey, revokedAt } : apiKey));
            setSuccess('API key revoked');
        } catch (err: unknown) {
            setApiKeyError(getApiErrorMessage(err, 'Failed to revoke API key'));
        } finally {
            setApiKeyActionLoading(false);
        }
    };

    return (
        <Layout
            collections={collections}
            selectedCollectionId="PROFILE"
            onSelectCollection={handleSelectCollection}
            onCreateCollection={handleCreateCollection}
            onEditCollection={handleEditCollection}
            onDeleteCollection={handleDeleteCollection}
        >
            <h1 className="text-3xl sm:text-5xl mb-6 sm:mb-8 text-slate-900 dark:text-white pl-1" style={{ fontFamily: 'Excalifont' }}>
                Profile
            </h1>

            {success && (
                <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-800 rounded-xl">
                    <p className="text-green-800 dark:text-green-200 font-medium">{success}</p>
                </div>
            )}
            {error && (
                <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-xl">
                    <p className="text-red-800 dark:text-red-200 font-medium">{error}</p>
                </div>
            )}

            <div className="space-y-6">
                <div className="bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-12 h-12 bg-indigo-50 dark:bg-neutral-800 rounded-xl flex items-center justify-center border-2 border-indigo-100 dark:border-neutral-700">
                            <User size={24} className="text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Personal Information</h2>
                    </div>

                            {mustResetPassword && (
                                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 rounded-xl">
                                    <p className="text-amber-900 dark:text-amber-200 font-bold">
                                        Password reset required
                                    </p>
                                    <p className="text-sm text-amber-800 dark:text-amber-200/80 font-medium mt-1">
                                        Change your password below before using ExcaliDash.
                                    </p>
                                </div>
                            )}
		                    <div className="space-y-4">
	                        <div>
	                            <label htmlFor="email" className="block text-sm font-bold text-slate-700 dark:text-neutral-300 mb-2">
	                                Email Address
	                            </label>
	                            <div className="flex gap-3">
	                                <input
	                                    id="email"
	                                    type="email"
	                                    value={email}
	                                    onChange={(e) => setEmail(e.target.value)}
	                                    disabled={!showEmailForm}
	                                    className={
	                                        showEmailForm
	                                            ? "flex-1 px-4 py-3 bg-white dark:bg-neutral-800 border-2 border-black dark:border-neutral-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 font-medium"
	                                            : "flex-1 px-4 py-3 bg-slate-50 dark:bg-neutral-800 border-2 border-slate-200 dark:border-neutral-700 rounded-xl text-slate-600 dark:text-neutral-400 cursor-not-allowed"
	                                    }
	                                />
		                                {!showEmailForm && (
		                                    <button
		                                        onClick={() => {
		                                            setShowEmailForm(true);
		                                            setEmailCurrentPassword('');
		                                            setError('');
		                                            setSuccess('');
		                                        }}
                                                disabled={mustResetPassword}
		                                        className="px-6 py-3 bg-white dark:bg-neutral-800 text-slate-700 dark:text-neutral-300 font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 transition-all duration-200"
		                                    >
		                                        Change
		                                    </button>
		                                )}
	                            </div>

	                            {showEmailForm && (
	                                <div className="mt-4 space-y-3">
	                                    <div>
	                                        <label htmlFor="emailCurrentPassword" className="block text-sm font-bold text-slate-700 dark:text-neutral-300 mb-2">
	                                            Current Password
	                                        </label>
	                                        <input
	                                            id="emailCurrentPassword"
	                                            type="password"
	                                            value={emailCurrentPassword}
	                                            onChange={(e) => setEmailCurrentPassword(e.target.value)}
	                                            className="w-full px-4 py-3 bg-white dark:bg-neutral-800 border-2 border-black dark:border-neutral-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 font-medium"
	                                            placeholder="Enter current password"
	                                        />
	                                    </div>
	                                    <div className="flex gap-3">
	                                        <button
	                                            onClick={handleUpdateEmail}
	                                            disabled={
	                                                emailLoading ||
	                                                !email.trim() ||
	                                                !emailCurrentPassword ||
	                                                email.trim() === authUser?.email
	                                            }
	                                            className="flex-1 px-6 py-3 bg-indigo-600 dark:bg-indigo-500 text-white font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
	                                        >
	                                            {emailLoading ? 'Saving...' : 'Save Email'}
	                                        </button>
	                                        <button
	                                            onClick={() => {
	                                                setShowEmailForm(false);
	                                                setEmail(authUser?.email || '');
	                                                setEmailCurrentPassword('');
	                                                setError('');
	                                            }}
	                                            disabled={emailLoading}
	                                            className="px-6 py-3 bg-white dark:bg-neutral-800 text-slate-700 dark:text-neutral-300 font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
	                                        >
	                                            <X size={18} />
	                                            Cancel
	                                        </button>
	                                    </div>
	                                </div>
	                            )}
	                        </div>

                        <div>
                            <label htmlFor="name" className="block text-sm font-bold text-slate-700 dark:text-neutral-300 mb-2">
                                Display Name
                            </label>
                            <div className="flex gap-3">
                                <input
                                    id="name"
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="flex-1 px-4 py-3 bg-white dark:bg-neutral-800 border-2 border-black dark:border-neutral-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 font-medium"
                                    placeholder="Your name"
                                />
	                                <button
	                                    onClick={handleUpdateName}
	                                    disabled={mustResetPassword || loading || !name.trim() || name === authUser?.name}
	                                    className="px-6 py-3 bg-indigo-600 dark:bg-indigo-500 text-white font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:disabled:hover:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] flex items-center gap-2"
	                                >
	                                    <Save size={18} />
	                                    Save
	                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-12 h-12 bg-emerald-50 dark:bg-neutral-800 rounded-xl flex items-center justify-center border-2 border-emerald-100 dark:border-neutral-700">
                            <KeyRound size={24} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">API Keys</h2>
                            <p className="text-sm text-slate-600 dark:text-neutral-400 font-medium">
                                Create bearer tokens for scripts and integrations. Tokens are shown only once.
                            </p>
                        </div>
                    </div>

                    {mustResetPassword ? (
                        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 rounded-xl">
                            <p className="text-amber-900 dark:text-amber-200 font-bold">
                                API key management is unavailable until you reset your password.
                            </p>
                            <p className="text-sm text-amber-800 dark:text-amber-200/80 font-medium mt-1">
                                Change your password below, then return here to create and manage API keys.
                            </p>
                        </div>
                    ) : (<>
                    {apiKeyError && (
                        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-xl">
                            <p className="text-red-800 dark:text-red-200 font-medium">{apiKeyError}</p>
                        </div>
                    )}

                    {generatedToken && (
                        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-800 rounded-xl" aria-live="polite">
                            <p className="text-amber-900 dark:text-amber-200 font-bold">
                                Copy this token now. You will not be able to see it again.
                            </p>
                            <p className="text-sm text-amber-800 dark:text-amber-200/80 font-medium mt-1">
                                New API key: {generatedTokenName}
                            </p>
                            <div className="mt-4 flex flex-col sm:flex-row gap-3">
                                <input
                                    aria-label={`Generated API token for ${generatedTokenName}`}
                                    value={generatedToken}
                                    readOnly
                                    className="flex-1 min-w-0 px-4 py-3 bg-white dark:bg-neutral-800 border-2 border-black dark:border-neutral-700 rounded-xl text-slate-900 dark:text-white font-mono text-sm"
                                    onFocus={(event) => event.target.select()}
                                />
                                <button
                                    onClick={() => void handleCopyGeneratedToken()}
                                    className="px-6 py-3 bg-emerald-600 dark:bg-emerald-500 text-white font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2"
                                    aria-label="Copy generated API token"
                                >
                                    <Copy size={18} />
                                    {copiedToken ? 'Copied' : 'Copy Token'}
                                </button>
                                <button
                                    onClick={handleHideGeneratedToken}
                                    className="px-6 py-3 bg-white dark:bg-neutral-800 text-slate-700 dark:text-neutral-300 font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 transition-all duration-200"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-3 mb-6">
                        <div className="flex-1">
                            <label htmlFor="apiKeyName" className="block text-sm font-bold text-slate-700 dark:text-neutral-300 mb-2">
                                API Key Name
                            </label>
                            <input
                                id="apiKeyName"
                                type="text"
                                value={apiKeyName}
                                onChange={(event) => setApiKeyName(event.target.value)}
                                maxLength={100}
                                className="w-full px-4 py-3 bg-white dark:bg-neutral-800 border-2 border-black dark:border-neutral-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400 font-medium"
                                placeholder="Example: Backup script"
                            />
                        </div>
                        <button
                            onClick={() => void handleCreateApiKey()}
                            disabled={apiKeysLoading || apiKeyActionLoading || !apiKeyName.trim()}
                            className="sm:self-end px-6 py-3 bg-emerald-600 dark:bg-emerald-500 text-white font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:disabled:hover:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)]"
                        >
                            {apiKeyActionLoading ? 'Creating...' : 'Create API Key'}
                        </button>
                    </div>

                    {apiKeysLoading ? (
                        <p className="text-slate-600 dark:text-neutral-400 font-medium">Loading API keys...</p>
                    ) : apiKeys.length === 0 ? (
                        <p className="text-slate-600 dark:text-neutral-400 font-medium">No API keys have been created yet.</p>
                    ) : (
                        <div className="space-y-4">
                            {apiKeys.map(apiKey => {
                                const revoked = Boolean(apiKey.revokedAt);
                                return (
                                    <div key={apiKey.id} className="p-4 bg-slate-50 dark:bg-neutral-800 border-2 border-slate-200 dark:border-neutral-700 rounded-xl">
                                        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white break-words">{apiKey.name}</h3>
                                                    <span className={revoked ? "px-2 py-1 text-xs font-bold rounded-full bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800" : "px-2 py-1 text-xs font-bold rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800"}>
                                                        {revoked ? 'Revoked' : 'Active'}
                                                    </span>
                                                </div>
                                                <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                                    <div>
                                                        <dt className="font-bold text-slate-700 dark:text-neutral-300">Prefix</dt>
                                                        <dd className="font-mono text-slate-600 dark:text-neutral-400 break-all">{apiKey.prefix}</dd>
                                                    </div>
                                                    <div>
                                                        <dt className="font-bold text-slate-700 dark:text-neutral-300">Scopes</dt>
                                                        <dd className="text-slate-600 dark:text-neutral-400">{apiKey.scopes.length > 0 ? apiKey.scopes.join(', ') : 'None'}</dd>
                                                    </div>
                                                    <div>
                                                        <dt className="font-bold text-slate-700 dark:text-neutral-300">Created</dt>
                                                        <dd className="text-slate-600 dark:text-neutral-400">{formatApiKeyDate(apiKey.createdAt)}</dd>
                                                    </div>
                                                    <div>
                                                        <dt className="font-bold text-slate-700 dark:text-neutral-300">Last Used</dt>
                                                        <dd className="text-slate-600 dark:text-neutral-400">{formatApiKeyDate(apiKey.lastUsedAt)}</dd>
                                                    </div>
                                                    <div>
                                                        <dt className="font-bold text-slate-700 dark:text-neutral-300">Revoked</dt>
                                                        <dd className="text-slate-600 dark:text-neutral-400">{formatApiKeyDate(apiKey.revokedAt)}</dd>
                                                    </div>
                                                </dl>
                                            </div>
                                            <button
                                                onClick={() => void handleRevokeApiKey(apiKey.id, apiKey.name)}
                                                disabled={apiKeyActionLoading || revoked}
                                                className="px-4 py-2 bg-white dark:bg-neutral-900 text-red-700 dark:text-red-300 font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:disabled:hover:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] flex items-center justify-center gap-2"
                                                aria-label={`Revoke API key ${apiKey.name}`}
                                            >
                                                <Trash2 size={18} />
                                                Revoke
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    </>)}
                </div>

                <div className="bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-rose-50 dark:bg-neutral-800 rounded-xl flex items-center justify-center border-2 border-rose-100 dark:border-neutral-700">
                                <Lock size={24} className="text-rose-600 dark:text-rose-400" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Change Password</h2>
                        </div>
                        {!showPasswordForm && !mustResetPassword && (
                            <button
                                onClick={() => setShowPasswordForm(true)}
                                className="px-4 py-2 bg-rose-600 dark:bg-rose-500 text-white font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 transition-all duration-200"
                            >
                                Change Password
                            </button>
                        )}
                    </div>

                    {showPasswordForm && (
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="currentPassword" className="block text-sm font-bold text-slate-700 dark:text-neutral-300 mb-2">
                                    Current Password
                                </label>
                                <input
                                    id="currentPassword"
                                    type="password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    className="w-full px-4 py-3 bg-white dark:bg-neutral-800 border-2 border-black dark:border-neutral-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500 dark:focus:ring-rose-400 font-medium"
                                    placeholder="Enter current password"
                                />
                            </div>

                            <div>
                                <label htmlFor="newPassword" className="block text-sm font-bold text-slate-700 dark:text-neutral-300 mb-2">
                                    New Password
                                </label>
                                <input
                                    id="newPassword"
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    minLength={passwordPolicy.minLength}
                                    maxLength={passwordPolicy.maxLength}
                                    pattern={passwordPolicy.patternHtml}
                                    className="w-full px-4 py-3 bg-white dark:bg-neutral-800 border-2 border-black dark:border-neutral-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500 dark:focus:ring-rose-400 font-medium"
                                    placeholder="Enter new password"
                                />
                                <PasswordRequirements
                                    password={newPassword}
                                    policy={passwordPolicy}
                                    className="text-slate-600 dark:text-neutral-400"
                                />
                            </div>

                            <div>
                                <label htmlFor="confirmPassword" className="block text-sm font-bold text-slate-700 dark:text-neutral-300 mb-2">
                                    Confirm New Password
                                </label>
                                <input
                                    id="confirmPassword"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    minLength={passwordPolicy.minLength}
                                    maxLength={passwordPolicy.maxLength}
                                    className="w-full px-4 py-3 bg-white dark:bg-neutral-800 border-2 border-black dark:border-neutral-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500 dark:focus:ring-rose-400 font-medium"
                                    placeholder="Confirm new password"
                                />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={handleChangePassword}
                                    disabled={loading || !currentPassword || !newPassword || !confirmPassword}
                                    className="flex-1 px-6 py-3 bg-rose-600 dark:bg-rose-500 text-white font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:disabled:hover:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)]"
                                >
                                    {loading ? 'Changing...' : 'Change Password'}
                                </button>
                                    {!mustResetPassword && (
	                                    <button
	                                        onClick={() => {
	                                            setShowPasswordForm(false);
	                                            setCurrentPassword('');
	                                            setNewPassword('');
	                                            setConfirmPassword('');
	                                            setError('');
	                                        }}
	                                        disabled={loading}
	                                        className="px-6 py-3 bg-white dark:bg-neutral-800 text-slate-700 dark:text-neutral-300 font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
	                                    >
	                                        <X size={18} />
	                                        Cancel
	                                    </button>
                                    )}
	                            </div>
	                        </div>
	                    )}
                </div>
            </div>
        </Layout>
    );
};

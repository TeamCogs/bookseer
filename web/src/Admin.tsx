import { useEffect, useState, type FormEvent } from 'react';
import { Check, LockKeyhole, Plus, UserPlus, Users } from 'lucide-react';
import type { User } from '../../shared/types';
import { api, message } from './api';

export { ConnectionsPage } from './ConnectionsPage';

type UserInput = {
  username: string;
  displayName: string;
  password: string;
  role: User['role'];
  autoApprove: boolean;
  weeklyLimit: number;
};
const newUser: UserInput = {
  username: '',
  displayName: '',
  password: '',
  role: 'user',
  autoApprove: false,
  weeklyLimit: 5,
};
export function UsersPage({ current, toast }: { current: User; toast: (s: string) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState(newUser);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  async function load() {
    setUsers((await api<{ items: User[] }>('/users')).items);
  }
  useEffect(() => {
    void load().catch((e) => setError(message(e)));
  }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/users', 'POST', form);
      await load();
      setForm(newUser);
      setCreating(false);
      toast('User created. Share their sign-in details privately.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      const { displayName, role, autoApprove, weeklyLimit, disabled } = editing;
      await api(`/users/${editing.id}`, 'PATCH', {
        displayName,
        role,
        autoApprove,
        weeklyLimit,
        disabled,
      });
      if (resetPassword)
        await api(`/users/${editing.id}/password`, 'PUT', { password: resetPassword });
      await load();
      setEditing(null);
      setResetPassword('');
      toast('User updated. Their previous sessions have been signed out.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>A library for everyone</h1>
          <p>Shared shelves. Individual accounts, requests, and updates.</p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setCreating(!creating);
            setEditing(null);
            setError('');
          }}
        >
          <UserPlus size={17} />
          Add user
        </button>
      </div>
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
      {creating ? (
        <form className="panel settings-section" onSubmit={(e) => void create(e)}>
          <h2>Create an account</h2>
          <div className="form-grid">
            <label className="field">
              Username
              <input
                required
                pattern="[A-Za-z0-9_.-]{3,40}"
                autoComplete="off"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </label>
            <label className="field">
              Display name
              <input
                required
                maxLength={80}
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </label>
            <label className="field">
              Initial password
              <input
                type="password"
                minLength={12}
                maxLength={256}
                required
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <small>At least 12 characters. Users can change it after signing in.</small>
            </label>
            <label className="field">
              Requests per seven days
              <input
                type="number"
                min={0}
                max={1000}
                value={form.weeklyLimit}
                onChange={(e) => setForm({ ...form, weeklyLimit: Number(e.target.value) })}
              />
              <small>0 means unlimited. Joining an existing request is free.</small>
            </label>
            <label className="field">
              Role
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}
              >
                <option value="user">User</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.autoApprove}
                onChange={(e) => setForm({ ...form, autoApprove: e.target.checked })}
              />
              Automatically approve this user’s requests
            </label>
          </div>
          <button className="button primary" disabled={busy}>
            <Plus size={17} />
            Create user
          </button>
        </form>
      ) : null}
      <div className="panel user-table">
        <div className="table-row table-head">
          <span>User</span>
          <span>Access</span>
          <span>Request approval</span>
          <span>Weekly limit</span>
          <span />
        </div>
        {users.map((user) => (
          <div className="table-row" key={user.id}>
            <span className="user-cell">
              <span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>
                  {user.displayName}
                  {user.id === current.id ? ' (you)' : ''}
                </strong>
                <small>
                  @{user.username}
                  {user.disabled ? ' · Disabled' : ''}
                </small>
              </span>
            </span>
            <span className="pill">{user.role === 'admin' ? 'Administrator' : 'User'}</span>
            <span className="muted">
              {user.role === 'admin' || user.autoApprove ? 'Automatic' : 'Admin approval'}
            </span>
            <span>
              {user.role === 'admin' || !user.weeklyLimit ? 'Unlimited' : user.weeklyLimit}
            </span>
            <button
              className="text-button"
              onClick={() => {
                setEditing({ ...user });
                setCreating(false);
                setResetPassword('');
                setError('');
              }}
            >
              Edit
            </button>
          </div>
        ))}
      </div>
      {editing ? (
        <form className="panel settings-section" onSubmit={(e) => void save(e)}>
          <div className="section-title">
            <h2>Edit {editing.displayName}</h2>
            <button type="button" className="text-button" onClick={() => setEditing(null)}>
              Close
            </button>
          </div>
          <div className="form-grid">
            <label className="field">
              Display name
              <input
                required
                value={editing.displayName}
                onChange={(e) => setEditing({ ...editing, displayName: e.target.value })}
              />
            </label>
            <label className="field">
              Role
              <select
                value={editing.role}
                disabled={editing.id === current.id}
                onChange={(e) => setEditing({ ...editing, role: e.target.value as User['role'] })}
              >
                <option value="user">User</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
            <label className="field">
              Weekly request limit
              <input
                type="number"
                min={0}
                max={1000}
                value={editing.weeklyLimit}
                onChange={(e) => setEditing({ ...editing, weeklyLimit: Number(e.target.value) })}
              />
            </label>
            {editing.id !== current.id ? (
              <label className="field">
                Reset password (optional)
                <input
                  type="password"
                  minLength={12}
                  maxLength={256}
                  autoComplete="new-password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
              </label>
            ) : null}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editing.autoApprove}
                onChange={(e) => setEditing({ ...editing, autoApprove: e.target.checked })}
              />
              Approve requests automatically
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={editing.id === current.id}
                checked={editing.disabled}
                onChange={(e) => setEditing({ ...editing, disabled: e.target.checked })}
              />
              Disable account and sign out sessions
            </label>
          </div>
          <button className="button primary" disabled={busy}>
            <Check size={17} />
            Save user
          </button>
        </form>
      ) : null}
      <p className="small muted footer-note">
        <Users size={15} /> Accounts are created by an administrator. Registration is closed by
        default.
      </p>
    </>
  );
}

export function AccountPage({ user, signedOut }: { user: User; signedOut: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('/account/password', 'PUT', {
        currentPassword: form.get('current'),
        newPassword: form.get('next'),
      });
      signedOut();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR ACCOUNT</p>
          <h1>Hello, {user.displayName}.</h1>
          <p>
            @{user.username} ·{' '}
            {user.role === 'admin'
              ? 'Administrator'
              : `${user.autoApprove ? 'Automatic approval' : 'Requests need approval'} · ${user.weeklyLimit || 'Unlimited'} requests per seven days`}
          </p>
        </div>
      </div>
      <form className="panel narrow settings-section" onSubmit={(e) => void change(e)}>
        <h2>Change your password</h2>
        <p className="muted">Changing your password signs out your existing sessions.</p>
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="field">
          Current password
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
        <label className="field">
          New password
          <input
            name="next"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            required
          />
          <small>At least 12 characters.</small>
        </label>
        <button className="button primary" disabled={busy}>
          <LockKeyhole size={17} />
          Change password
        </button>
      </form>
    </>
  );
}

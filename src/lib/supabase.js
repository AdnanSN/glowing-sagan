import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isConfigured = supabaseUrl && supabaseAnonKey &&
  supabaseUrl !== 'your_supabase_project_url' &&
  supabaseAnonKey !== 'your_supabase_anon_key'

// Real client when configured, mock stub when not (so the app doesn't crash)
const mockClient = {
  from: () => ({
    select: () => ({ data: [], error: null, order: () => ({ data: [], error: null }), eq: () => ({ data: null, error: null, single: () => ({ data: null, error: null }) }) }),
    insert: () => ({ data: null, error: null }),
    update: () => ({ eq: () => ({ data: null, error: null }) }),
    delete: () => ({ eq: () => ({ data: null, error: null }) }),
  }),
}

// Proper chainable mock for Supabase query builder pattern
function makeQueryBuilder(defaultReturn = []) {
  const builder = {
    data: defaultReturn,
    error: null,
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    eq: () => builder,
    not: () => builder,
    order: () => builder,
    single: () => ({ data: null, error: null }),
    then: (resolve) => resolve({ data: defaultReturn, error: null }),
  }
  return builder
}

function makeFrom() {
  return {
    select: (_cols) => ({
      order: (_col, _opts) => Promise.resolve({ data: [], error: null }),
      eq: (_col, _val) => ({
        order: (_c, _o) => Promise.resolve({ data: [], error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
      }),
      not: (_col, _op, _val) => Promise.resolve({ data: [], error: null }),
    }),
    insert: (_data) => Promise.resolve({ data: null, error: null }),
    update: (_data) => ({
      eq: (_col, _val) => Promise.resolve({ data: null, error: null }),
    }),
    delete: () => ({
      eq: (_col, _val) => Promise.resolve({ data: null, error: null }),
    }),
  }
}

// Without credentials every call resolves to a clear error instead of
// throwing on `supabase.auth` being undefined — the setup banner explains why.
const notConfigured = () =>
  Promise.resolve({ data: null, error: { message: 'Supabase is not configured.' } })

const stub = {
  from: () => makeFrom(),
  rpc: () => notConfigured(),
  // Site photos sign their URLs on page load rather than on a click, so
  // this has to answer rather than be undefined.
  storage: {
    from: () => ({
      upload: notConfigured,
      remove: notConfigured,
      list: () => Promise.resolve({ data: [], error: null }),
      createSignedUrls: () => Promise.resolve({ data: [], error: null }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
    }),
  },
  auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: notConfigured,
    signUp: notConfigured,
    signOut: () => Promise.resolve({ error: null }),
    updateUser: notConfigured,
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
  },
}

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : stub

export const supabaseConfigured = isConfigured

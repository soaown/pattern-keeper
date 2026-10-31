import { SUPABASE_URL, SUPABASE_ANON_KEY } from './sync-config.js';

const enabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const api = enabled ? await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm') : null;
const supabase = enabled ? api.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let user = null;
let patternId = null;
let applyRemote = null;
let pending = [];
let sending = false;
let pollTimer = null;

const panel = document.createElement('div');
panel.className = 'cloud-sync-bar';
panel.innerHTML = `<span id="cloudState">${enabled ? '동기화: 로그인 필요' : '동기화 설정 필요'}</span><input id="cloudEmail" type="email" placeholder="이메일 주소" autocomplete="email"><input id="cloudPassword" type="password" placeholder="비밀번호" autocomplete="current-password"><button id="cloudLogin">로그인</button><button id="cloudSetPassword" hidden>비밀번호 설정·변경</button><button id="cloudLogout" hidden>로그아웃</button>`;
(document.querySelector('#syncSettings') || document.querySelector('.toolbar'))?.append(panel);
const state = panel.querySelector('#cloudState');
const login = panel.querySelector('#cloudLogin');
const logout = panel.querySelector('#cloudLogout');
const email = panel.querySelector('#cloudEmail');
const password = panel.querySelector('#cloudPassword');
const setPassword = panel.querySelector('#cloudSetPassword');
if (!enabled) { login.disabled = true; email.disabled = true; password.disabled = true; }

function setState(message) { state.textContent = message; }
function refreshUI() {
  login.hidden = Boolean(user);
  email.hidden = Boolean(user);
  setPassword.hidden = !user;
  password.placeholder = user ? '새 비밀번호 (6자 이상)' : '비밀번호';
  password.autocomplete = user ? 'new-password' : 'current-password';
  logout.hidden = !user;
  if (user) setState(`동기화 계정: ${user.email}`);
}
async function readAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*')
      .eq('user_id', user.id).eq('pattern_id', patternId).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}
async function pull() {
  if (!user || !patternId || !applyRemote) return;
  try {
    const [progress, colors] = await Promise.all([
      readAll('pattern_cell_progress'), readAll('pattern_thread_colors')
    ]);
    applyRemote(progress, colors);
    setState(`동기화 완료 · ${user.email}`);
  } catch (error) { setState(`동기화 오류: ${error.message}`); }
}
async function flush() {
  if (sending || !user || !patternId || !pending.length) return;
  sending = true;
  try {
    while (pending.length) {
      const batch = pending.slice(0, 100);
      const progress = batch.filter(x => x.type === 'cell').map(x => ({
        user_id: user.id, pattern_id: patternId, cell_id: x.id, checked: x.checked
      }));
      const colors = batch.filter(x => x.type === 'color').map(x => ({
        user_id: user.id, pattern_id: patternId, dmc: x.dmc, hex: x.hex
      }));
      for (const [table, rows] of [['pattern_cell_progress', progress], ['pattern_thread_colors', colors]]) {
        if (!rows.length) continue;
        const { error } = await supabase.from(table).upsert(rows);
        if (error) throw error;
      }
      pending.splice(0, batch.length);
    }
    setState(`동기화 완료 · ${user.email}`);
  } catch (error) {
    setState(`저장 실패: ${error.message}`);
  } finally { sending = false; }
}
login.onclick = async () => {
  const address = email.value.trim();
  const secret = password.value;
  if (!enabled || !address || !secret) { setState('이메일과 비밀번호를 입력해 주세요.'); return; }
  login.disabled = true;
  setState('로그인 중...');
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: address, password: secret });
    if (error) throw error;
    password.value = '';
    setState('로그인 성공 · 동기화 준비 중');
  } catch (error) { setState(`로그인 오류: ${error.message}`); }
  finally { login.disabled = false; }
};
setPassword.onclick = async () => {
  if (!user) return;
  const secret = password.value;
  if (secret.length < 6) { setState('새 비밀번호를 6자 이상 입력해 주세요.'); return; }
  setPassword.disabled = true;
  setState('비밀번호 설정 중...');
  try {
    const { error } = await supabase.auth.updateUser({ password: secret });
    if (error) throw error;
    password.value = '';
    setState('비밀번호 설정 완료 · 다른 기기에서 로그인할 수 있어요.');
  } catch (error) { setState(`비밀번호 설정 오류: ${error.message}`); }
  finally { setPassword.disabled = false; }
};
logout.onclick = async () => { await supabase.auth.signOut(); user = null; refreshUI(); };
if (enabled) {
  const { data } = await supabase.auth.getUser();
  user = data.user;
  refreshUI();
  supabase.auth.onAuthStateChange((_event, session) => {
    user = session?.user ?? null;
    refreshUI();
    if (user && patternId) setTimeout(pull, 0);
  });
  pollTimer = setInterval(() => { if (user && patternId && !pending.length) pull(); }, 15000);
  window.addEventListener('online', () => { flush(); pull(); });
}
export const cloudSync = {
  get enabled() { return enabled; },
  get signedIn() { return Boolean(user); },
  async openPattern(id, onRemote) { patternId = id; applyRemote = onRemote; if (user) await pull(); },
  cell(id, checked) { if (!user) return; pending.push({ type: 'cell', id, checked }); flush(); },
  color(dmc, hex) { if (!user) return; pending.push({ type: 'color', dmc, hex }); flush(); }
};

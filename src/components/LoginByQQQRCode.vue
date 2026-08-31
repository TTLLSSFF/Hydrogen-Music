<script setup>
import { onUnmounted, ref } from 'vue'
import QRCode from 'qrcode'
import DataCheckAnimaton from './DataCheckAnimaton.vue'
import { getQQLoginQr, checkQQLoginQr } from '../api/qq'
import { normalizeQrState } from '../utils/qqLoginState.mjs'
import { qqAccountStore } from '../store/qqAccountStore'
import { extractQQLoginPayload, sanitizeQQQrImage } from '../utils/qqSession.mjs'

const emit = defineEmits(['jumpTo', 'success'])
const qrImage = ref('')
const status = ref('idle')
const message = ref('Scan with QQ Music to sign in')
let timer = null
let loginSessionId = ''

function clearTimer() {
  if (timer) clearTimeout(timer)
  timer = null
}

async function poll() {
  if (!loginSessionId) return
  try {
    const result = await checkQQLoginQr(loginSessionId)
    const payload = extractQQLoginPayload(result) || result
    const code = result?.code ?? payload?.code
    status.value = payload?.isOk === true || payload?.success === true
      ? 'confirmed'
      : payload?.refresh === true
        ? 'expired'
        : normalizeQrState(code)

    if (status.value === 'confirmed') {
      clearTimer()
      loginSessionId = ''
      const clientSession = payload?.clientSession || result?.clientSession
      if (!clientSession) throw new Error('QQ login credential was not returned')
      qqAccountStore.setSessionToken(clientSession)
      await qqAccountStore.restoreSession()
      if (!qqAccountStore.loggedIn) throw new Error('QQ login verification failed')
      emit('success', qqAccountStore.user)
      emit('jumpTo')
      return
    }

    message.value = status.value === 'expired'
      ? 'QR code expired. Refresh to try again.'
      : status.value === 'scanned'
        ? 'Confirm the login request in QQ Music.'
        : 'Scan with QQ Music to sign in.'
    if (status.value !== 'expired') timer = setTimeout(poll, 1200)
    else loginSessionId = ''
  } catch (error) {
    message.value = error?.message || 'Unable to check QQ login status.'
    timer = setTimeout(poll, 2000)
  }
}

async function load() {
  clearTimer()
  status.value = 'loading'
  qrImage.value = ''
  try {
    const result = await getQQLoginQr()
    const data = extractQQLoginPayload(result) || result
    loginSessionId = String(result?.sessionId || data?.sessionId || '')
    const url = sanitizeQQQrImage(String(data?.img || data?.url || data?.qrUrl || data?.qrimg || ''))
    if (!loginSessionId || !url) throw new Error('Unable to create QQ login QR code')
    qrImage.value = String(url).startsWith('data:') ? url : await QRCode.toDataURL(url, { width: 192, margin: 1 })
    status.value = 'waiting'
    message.value = 'Scan with QQ Music to sign in.'
    timer = setTimeout(poll, 1000)
  } catch (error) {
    loginSessionId = ''
    status.value = 'error'
    message.value = error?.message || 'Unable to create QQ login QR code.'
  }
}

function refreshQRCode() {
  if (status.value === 'expired' || status.value === 'error') load()
}

defineExpose({ load, clearTimer })
onUnmounted(() => {
  clearTimer()
  loginSessionId = ''
})
</script>

<template>
  <div class="qq-login-qr" :class="{ 'is-refreshable': status === 'expired' || status === 'error' }" @click="refreshQRCode">
    <div class="qrcode-border" :class="{ 'is-scanned': status === 'scanned', 'is-confirmed': status === 'confirmed' }">
      <div class="qrcode" :class="{ 'is-invalid': status === 'expired' || status === 'error' }">
        <img v-if="qrImage" :src="qrImage" alt="QQ Music login QR code" width="192" height="192">
        <span v-else class="qrcode-loading">LOADING</span>
      </div>
      <div class="qrcode-status" :class="{ 'status-danger': status === 'expired' || status === 'error', 'status-visible': status === 'scanned', 'status-confirmed': status === 'confirmed' }">
        {{ status === 'scanned' ? 'CONFIRM ON PHONE' : status === 'confirmed' ? 'LOGIN SUCCESS' : status === 'expired' ? 'QR CODE EXPIRED' : status === 'error' ? 'LOAD FAILED' : 'SCAN WITH QQ MUSIC' }}
      </div>
      <div class="border border1"></div>
      <div class="border border2"></div>
      <div class="border border3"></div>
      <div class="border border4"></div>
      <div class="qr-line qr-line1"></div>
      <div class="qr-line qr-line2"></div>
      <div class="qr-line qr-line3"></div>
      <div class="qr-line qr-line4"></div>
      <div class="qrcode-text">QQ MUSIC</div>
      <DataCheckAnimaton v-if="status === 'confirmed'" class="check-animation" />
    </div>
    <button v-if="status === 'expired' || status === 'error'" type="button" class="refresh-button" @click.stop="load">Refresh QR code</button>
    <p class="qq-login-hint">{{ message }}</p>
  </div>
</template>

<style scoped lang="scss">
.qq-login-qr {
  margin-top: 7vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  --qq-qr-text: var(--text);
  --qq-qr-border: var(--text);
  --qq-qr-line-fade: var(--border);
  --qq-qr-status-bg: rgba(0, 0, 0, 0.92);
  --qq-qr-status-danger: #c62828;
  --qq-qr-status-text: #ffffff;
  &.is-refreshable { cursor: pointer; }
  .qrcode-border {
    width: 27.6vh;
    height: 27.6vh;
    min-width: 212px;
    min-height: 212px;
    position: relative;
    transition: width 0.25s ease, height 0.25s ease;
    .qrcode {
      width: 26vh;
      height: 26vh;
      min-width: 200px;
      min-height: 200px;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      transition: opacity 0.25s ease, transform 0.25s ease;
      img { width: 100%; height: 100%; display: block; }
      .qrcode-loading { display: block; font: 16px Gilroy-ExtraBold; line-height: 26vh; text-align: center; color: var(--qq-qr-text); }
      &.is-invalid { opacity: 0.35; }
    }
    .qrcode-status {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 0;
      padding: 8px 0;
      transform: translate(-50%, -50%);
      overflow: hidden;
      white-space: nowrap;
      text-align: center;
      font: 12px SourceHanSansCN-Bold;
      color: transparent;
      background: var(--qq-qr-status-bg);
      opacity: 0;
      transition: width 0.25s ease, opacity 0.25s ease, color 0.25s ease;
      &.status-visible, &.status-danger { width: 100%; color: var(--qq-qr-status-text); opacity: 1; }
      &.status-danger { background: var(--qq-qr-status-danger); }
      &.status-confirmed {
        width: 100%;
        color: var(--qq-qr-status-text);
        opacity: 1;
        transition-delay: 0.95s;
      }
    }
    .border { width: 40px; height: 40px; position: absolute; border-color: var(--qq-qr-border); border-style: solid; }
    .border1 { top: 0; left: 0; border-width: 2px 0 0 2px; }
    .border2 { top: 0; right: 0; border-width: 2px 2px 0 0; }
    .border3 { bottom: 0; right: 0; border-width: 0 2px 2px 0; }
    .border4 { bottom: 0; left: 0; border-width: 0 0 2px 2px; }
    .qr-line { width: 40px; height: 1px; position: absolute; background: linear-gradient(to right, var(--qq-qr-border) 30%, var(--qq-qr-line-fade)); }
    .qr-line1 { top: -13px; left: -32px; transform: rotate(-135deg); }
    .qr-line2 { top: -13px; right: -32px; transform: rotate(-45deg); }
    .qr-line3 { bottom: -13px; right: -32px; transform: rotate(45deg); }
    .qr-line4 { bottom: -13px; left: -32px; transform: rotate(135deg); }
    .qrcode-text { position: absolute; top: -1.2vh; left: 0.2vh; font: 1vh Geometos; color: var(--qq-qr-text); }
    .check-animation { position: absolute; inset: 0; width: 100%; height: 100%; }
    &.is-scanned .qrcode { opacity: 0.3; transform: translate(-50%, -50%) scale(0.86); }
    &.is-confirmed { width: 22vh; height: 22vh; min-width: 170px; min-height: 170px; }
    &.is-confirmed .qrcode { opacity: 0; transform: translate(-50%, -50%) scale(0.84); transition: opacity 0.2s ease 0.75s, transform 0.35s cubic-bezier(.14,.91,.58,1) 0.75s; }
    &.is-confirmed .border, &.is-confirmed .qr-line { opacity: 0; animation: qq-qr-fade 0.35s ease forwards; }
  }
  .refresh-button { margin-top: 16px; border: 1px solid currentColor; padding: 7px 14px; color: var(--qq-qr-text); background: transparent; font: 12px SourceHanSansCN-Bold; cursor: pointer; transition: opacity 0.2s ease; &:hover { opacity: 0.65; } }
  .qq-login-hint { min-height: 20px; margin: 14px 0 0; color: var(--qq-qr-text); font: 12px SourceHanSansCN-Bold; text-align: center; opacity: 0.72; }
}
@keyframes qq-qr-fade { from { opacity: 1; } to { opacity: 0; } }
:global(.dark) .qq-login-qr { --qq-qr-status-bg: rgba(17, 24, 33, 0.94); --qq-qr-status-danger: #c94b4b; --qq-qr-status-text: #f2f5f7; }
@media (max-width: 520px) {
  .qq-login-qr .qrcode-border { width: 240px; height: 240px; min-width: 0; min-height: 0; }
  .qq-login-qr .qrcode-border .qrcode { width: 224px; height: 224px; min-width: 0; min-height: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .qq-login-qr *, .qq-login-qr *::before, .qq-login-qr *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
  }
}
</style>

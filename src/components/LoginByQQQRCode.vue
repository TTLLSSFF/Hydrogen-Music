<script setup>
import { onUnmounted, ref } from 'vue'
import QRCode from 'qrcode'
import { getQQLoginQr, checkQQLoginQr } from '../api/qq'
import { normalizeQrState } from '../utils/qqLoginState.mjs'
import { qqAccountStore } from '../store/qqAccountStore'
import { extractQQLoginPayload, sanitizeQQQrImage } from '../utils/qqSession.mjs'

const emit = defineEmits(['jumpTo', 'success'])
const qrImage = ref('')
const status = ref('idle')
const message = ref('点击生成 QQ 音乐登录二维码')
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
      if (!clientSession) throw new Error('QQ 登录凭证未返回，请重新扫码')
      qqAccountStore.setSessionToken(clientSession)
      await qqAccountStore.restoreSession()
      if (!qqAccountStore.loggedIn) throw new Error('QQ 登录状态校验失败，请重新扫码')
      emit('success', qqAccountStore.user)
      emit('jumpTo')
      return
    }
    message.value = status.value === 'expired' ? '二维码已过期，请重新生成' : status.value === 'scanned' ? '请在手机上确认登录' : '请使用 QQ 音乐扫码登录'
    if (status.value !== 'expired') timer = setTimeout(poll, 1200)
    else loginSessionId = ''
  } catch (error) {
    message.value = error?.message || '登录状态获取失败'
    timer = setTimeout(poll, 2000)
  }
}

async function load() {
  clearTimer()
  status.value = 'loading'
  try {
    const result = await getQQLoginQr()
    const data = extractQQLoginPayload(result) || result
    loginSessionId = String(result?.sessionId || data?.sessionId || '')
    const url = sanitizeQQQrImage(String(data?.img || data?.url || data?.qrUrl || data?.qrimg || ''))
    if (!loginSessionId || !url) throw new Error('QQ 登录二维码生成失败')
    qrImage.value = String(url).startsWith('data:') ? url : await QRCode.toDataURL(url, { width: 192, margin: 1 })
    status.value = 'waiting'
    message.value = '请使用 QQ 音乐扫码登录'
    timer = setTimeout(poll, 1000)
  } catch (error) {
    loginSessionId = ''
    status.value = 'error'
    message.value = error?.message || 'QQ 登录二维码生成失败'
  }
}

defineExpose({ load, clearTimer })
onUnmounted(() => {
  clearTimer()
  loginSessionId = ''
})
</script>

<template>
  <div class="qq-login-qr">
    <img v-if="qrImage" :src="qrImage" alt="QQ 音乐登录二维码" width="192" height="192">
    <p>{{ message }}</p>
    <button type="button" @click="load">{{ status === 'expired' || status === 'error' ? '重新生成' : '生成二维码' }}</button>
  </div>
</template>

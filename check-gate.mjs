/**
 * check-gate.mjs — 排查 dsh-hrinfo-boot 的密码面板到底有没有生效。
 *
 * 用法：
 *   node check-gate.mjs <port> <token>            只看关卡标志
 *   node check-gate.mjs <port> <token> <code>     顺便试一次解锁
 *
 * token 就是浏览器地址栏里 `http://127.0.0.1:3080/?token=XXXX` 的那一串。
 *
 * 期望：
 *   __dsh550cGate = true        → 会弹密码面板
 *   __dsh550cGate = false       → 主机没读到码文件（查 DSH home 里的 hrinfo-boot.json）
 *   解锁 200 {"ok":true}        → 码正确
 *   解锁 401 WRONG PASSWORD     → 码不对
 */
const [port, token, code] = process.argv.slice(2)
if (!port || !token) {
  console.error('用法: node check-gate.mjs <port> <token> [code]')
  process.exit(2)
}
const base = `http://127.0.0.1:${port}`

const first = await fetch(`${base}/?token=${token}`, { redirect: 'manual' })
console.log(`GET /?token=… -> HTTP ${first.status}`)
const setCookie = first.headers.get('set-cookie')
const cookie = setCookie ? setCookie.split(';')[0] : ''
const url = new URL(first.headers.get('location') ?? '/', `${base}/`).href
const page = await fetch(url, { headers: cookie ? { cookie } : {}, redirect: 'manual' })
const html = await page.text()
console.log(`GET ${url} -> HTTP ${page.status} (${html.length} bytes)`)

let found = false
for (const line of html.matchAll(/globalThis\["(__dsh550c\w+)"\]\s*=\s*([^<]+)/g)) {
  console.log(`  ${line[1]} = ${line[2].trim()}`)
  if (line[1] === '__dsh550cGate') found = true
}
if (!found) console.log('  (页面里没有 __dsh550cGate —— 插件可能没装上)')

if (code !== undefined) {
  const res = await fetch(`${base}/hrinfo-boot/unlock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ password: code }),
  })
  console.log(`POST /hrinfo-boot/unlock {"password":"${code}"} -> HTTP ${res.status} ${await res.text()}`)
}

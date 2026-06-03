// UPnP/DLNA 推流模块 — 纯 Node.js 零依赖
// 功能：SSDP 扫描局域网 DLNA 媒体渲染器，通过 SOAP 控制播放
import { createSocket } from 'node:dgram';
import http from 'node:http';

// ── 常量 ───────────────────────────────────────
const SSDP_MULTICAST = '239.255.255.250';
const SSDP_PORT = 1900;
const MSEARCH_HEADERS = [
  'M-SEARCH * HTTP/1.1',
  `HOST: ${SSDP_MULTICAST}:${SSDP_PORT}`,
  'MAN: "ssdp:discover"',
  'MX: 3',
  'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
  '',
  '',
].join('\r\n');

// ── 简单的 XML 值提取（避免引入 xml2js） ─────────
function xmlTagValue(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function extractDeviceInfo(xml, locationUrl) {
  const url = new URL(locationUrl);
  const host = url.hostname;
  const port = url.port || 80;

  const name = xmlTagValue(xml, 'friendlyName') || 'Unknown Device';
  const uuid = xmlTagValue(xml, 'UDN') || '';

  // 提取 AVTransport controlURL
  let controlURL = null;
  const serviceRe = /<service>([\s\S]*?)<\/service>/gi;
  let s;
  while ((s = serviceRe.exec(xml)) !== null) {
    const block = s[1];
    const st = xmlTagValue(block, 'serviceType') || '';
    const scpd = xmlTagValue(block, 'SCPDURL') || '';
    const cu = xmlTagValue(block, 'controlURL') || '';
    if (st.includes('AVTransport') && cu) {
      controlURL = cu.startsWith('/') ? cu : '/' + cu;
    }
  }

  // 提取 RenderingControl controlURL
  let renderControlURL = null;
  const rsRe = /<service>([\s\S]*?)<\/service>/gi;
  let rs;
  while ((rs = rsRe.exec(xml)) !== null) {
    const block = rs[1];
    const st = xmlTagValue(block, 'serviceType') || '';
    const cu = xmlTagValue(block, 'controlURL') || '';
    if (st.includes('RenderingControl') && cu) {
      renderControlURL = cu.startsWith('/') ? cu : '/' + cu;
    }
  }

  return {
    name,
    host,
    port: Number(port),
    controlURL,
    renderControlURL,
    uuid,
    location: locationUrl,
  };
}

// ── SSDP 扫描 ────────────────────────────────
const DEVICE_TIMEOUT_MS = 30000; // 30 秒内去重
const seenUuidTimestamps = new Map();

function scanDevices(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const devices = new Map(); // uuid → device

    const done = () => {
      try { socket.close(); } catch {}
      const list = [...devices.values()];
      resolve(list);
    };

    const timer = setTimeout(done, timeoutMs);

    socket.on('message', async (msg, rinfo) => {
      const response = msg.toString();
      if (!response.includes('200 OK') && !response.includes('NOTIFY')) return;
      if (!response.includes('MediaRenderer')) return;

      // 提取 LOCATION
      const locMatch = response.match(/LOCATION:\s*(.+)/i);
      if (!locMatch) return;
      const location = locMatch[1].trim();

      // 提取 USN/UUID 做初步去重
      const usnMatch = response.match(/USN:\s*(.+)/i);
      const usn = usnMatch ? usnMatch[1].trim() : location;

      // 检查是否最近见过
      const now = Date.now();
      if (seenUuidTimestamps.has(usn)) {
        if (now - seenUuidTimestamps.get(usn) < DEVICE_TIMEOUT_MS) return;
      }
      seenUuidTimestamps.set(usn, now);

      // 获取设备描述 XML
      try {
        const descXml = await fetchXml(location);
        if (!descXml) return;

        const info = extractDeviceInfo(descXml, location);

        if (info.uuid && info.controlURL) {
          devices.set(info.uuid, info);
        }
      } catch {
        // 设备响应超时，跳过
      }
    });

    socket.on('error', () => {
      clearTimeout(timer);
      done();
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.setMulticastTTL(4);
      socket.send(MSEARCH_HEADERS, SSDP_PORT, SSDP_MULTICAST, (err) => {
        if (err) {
          clearTimeout(timer);
          done();
        }
      });
    });
  });
}

// ── HTTP 请求辅助 ──────────────────────────────
function fetchXml(url) {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname, search } = new URL(url);
    const req = http.get(
      {
        hostname,
        port: port || 80,
        path: pathname + (search || ''),
        timeout: 5000,
        headers: { 'User-Agent': 'Claudio-UPnP/0.1' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('error', () => reject(new Error('fetch failed')));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── SOAP 调用 ────────────────────────────────
function soapRequest({ host, port, path, action, bodyParts }) {
  const soapBody = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    '<s:Body>',
    ...bodyParts,
    '</s:Body>',
    '</s:Envelope>',
  ].join('');

  const soapActionHeader = `"${action}"`;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path,
        method: 'POST',
        timeout: 8000,
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPACTION': soapActionHeader,
          'User-Agent': 'Claudio-UPnP/0.1',
          'Content-Length': Buffer.byteLength(soapBody, 'utf8'),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode === 200) {
            resolve({ ok: true, body });
          } else {
            resolve({ ok: false, status: res.statusCode, body });
          }
        });
      }
    );
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('SOAP timeout')); });
    req.write(soapBody);
    req.end();
  });
}

// ── 推送音频 URL ─────────────────────────────
async function pushToDevice(device, audioUrl, metadata = null) {
  const metaXml = metadata || buildDIDLLite(audioUrl);
  const action = 'urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI';
  const bodyParts = [
    '<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">',
    '<InstanceID>0</InstanceID>',
    `<CurrentURI>${escapeXml(audioUrl)}</CurrentURI>`,
    `<CurrentURIMetaData>${escapeXml(metaXml)}</CurrentURIMetaData>`,
    '</u:SetAVTransportURI>',
  ];
  return soapRequest({
    host: device.host,
    port: device.port,
    path: device.controlURL,
    action,
    bodyParts,
  });
}

// ── 播放控制 ────────────────────────────────
async function play(device) {
  const action = 'urn:schemas-upnp-org:service:AVTransport:1#Play';
  return soapRequest({
    host: device.host,
    port: device.port,
    path: device.controlURL,
    action,
    bodyParts: [
      '<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">',
      '<InstanceID>0</InstanceID>',
      '<Speed>1</Speed>',
      '</u:Play>',
    ],
  });
}

async function pause(device) {
  const action = 'urn:schemas-upnp-org:service:AVTransport:1#Pause';
  return soapRequest({
    host: device.host,
    port: device.port,
    path: device.controlURL,
    action,
    bodyParts: [
      '<u:Pause xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">',
      '<InstanceID>0</InstanceID>',
      '</u:Pause>',
    ],
  });
}

async function stop(device) {
  const action = 'urn:schemas-upnp-org:service:AVTransport:1#Stop';
  return soapRequest({
    host: device.host,
    port: device.port,
    path: device.controlURL,
    action,
    bodyParts: [
      '<u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">',
      '<InstanceID>0</InstanceID>',
      '</u:Stop>',
    ],
  });
}

// ── 音量控制 ────────────────────────────────
async function getVolume(device) {
  const action = 'urn:schemas-upnp-org:service:RenderingControl:1#GetVolume';
  const renderPath = device.renderControlURL || device.controlURL.replace('AVTransport', 'RenderingControl');
  return soapRequest({
    host: device.host,
    port: device.port,
    path: renderPath,
    action,
    bodyParts: [
      '<u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">',
      '<InstanceID>0</InstanceID>',
      '<Channel>Master</Channel>',
      '</u:GetVolume>',
    ],
  });
}

async function setVolume(device, vol) {
  const action = 'urn:schemas-upnp-org:service:RenderingControl:1#SetVolume';
  const renderPath = device.renderControlURL || device.controlURL.replace('AVTransport', 'RenderingControl');
  return soapRequest({
    host: device.host,
    port: device.port,
    path: renderPath,
    action,
    bodyParts: [
      '<u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">',
      '<InstanceID>0</InstanceID>',
      '<Channel>Master</Channel>',
      `<DesiredVolume>${vol}</DesiredVolume>`,
      '</u:SetVolume>',
    ],
  });
}

// ── 设备信息（当前播放状态） ─────────────────
async function deviceInfo(device) {
  // 同时获取 TransportInfo 和 PositionInfo
  const [transportResult, positionResult] = await Promise.allSettled([
    soapRequest({
      host: device.host,
      port: device.port,
      path: device.controlURL,
      action: 'urn:schemas-upnp-org:service:AVTransport:1#GetTransportInfo',
      bodyParts: [
        '<u:GetTransportInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">',
        '<InstanceID>0</InstanceID>',
        '</u:GetTransportInfo>',
      ],
    }),
    soapRequest({
      host: device.host,
      port: device.port,
      path: device.controlURL,
      action: 'urn:schemas-upnp-org:service:AVTransport:1#GetPositionInfo',
      bodyParts: [
        '<u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">',
        '<InstanceID>0</InstanceID>',
        '</u:GetPositionInfo>',
      ],
    }),
  ]);

  const info = { state: 'UNKNOWN', title: '', artist: '', duration: '', position: '' };

  if (transportResult.status === 'fulfilled' && transportResult.value.ok) {
    const t = transportResult.value.body;
    info.state = xmlTagValue(t, 'CurrentTransportState') || 'UNKNOWN';
  }

  if (positionResult.status === 'fulfilled' && positionResult.value.ok) {
    const p = positionResult.value.body;
    info.duration = xmlTagValue(p, 'TrackDuration') || '';
    info.position = xmlTagValue(p, 'RelTime') || '';
    const meta = xmlTagValue(p, 'TrackMetaData') || '';
    if (meta) {
      // 尝试从 DIDL-Lite 中提取标题
      const titleMatch = meta.match(/<dc:title[^>]*>(.+?)<\/dc:title>/i);
      if (titleMatch) info.title = titleMatch[1];
      const artistMatch = meta.match(/<upnp:artist[^>]*>(.+?)<\/upnp:artist>/i);
      if (artistMatch) info.artist = artistMatch[1];
    }
  }

  return info;
}

// ── DIDL-Lite 元数据构建 ─────────────────────
function buildDIDLLite(audioUrl, title = '', artist = '') {
  // 从 URL 推断文件名作为标题
  const fileName = title || decodeURIComponent(audioUrl.split('/').pop()?.split('?')[0] || 'Stream');
  return [
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"',
    'xmlns:dc="http://purl.org/dc/elements/1.1/"',
    'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"',
    'xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">',
    '<item id="0" parentID="-1" restricted="1">',
    `<dc:title>${escapeXml(fileName)}</dc:title>`,
    artist ? `<upnp:artist>${escapeXml(artist)}</upnp:artist>` : '',
    '<upnp:class>object.item.audioItem.musicTrack</upnp:class>',
    `</item>`,
    `</DIDL-Lite>`,
  ].join('');
}

// ── XML 转义 ────────────────────────────────
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── 导出 info ────────────────────────────────
let cachedDevices = [];
let lastScanTime = 0;

async function info() {
  const devices = await scanDevices();
  cachedDevices = devices;
  lastScanTime = Date.now();
  return {
    available: devices.length > 0,
    deviceCount: devices.length,
    devices: devices.map((d) => ({
      name: d.name,
      host: d.host,
      port: d.port,
      uuid: d.uuid,
    })),
  };
}

// ── 导出 ─────────────────────────────────────
export {
  scanDevices,
  pushToDevice,
  play,
  pause,
  stop,
  getVolume,
  setVolume,
  deviceInfo,
  buildDIDLLite,
  info,
};

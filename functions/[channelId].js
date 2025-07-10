export async function onRequest({ request, params }) {
  const geo = request.eo.geo;
  const channelId = params.channelId || 'cctv1HD';
  const cacheChannelId = channelId.toLowerCase();

  let redirectUrl = null;

  // 查找KV，并检查KV里的数据是否过期
  let cachedData = await iptv_live_cqcb.get(cacheChannelId, "json") || {};
  let currentTime = new Date().getTime();
  let cacheDuration = 1800000; // 30分钟

  if (geo.regionCode === 'CN-CQ') {
    if (cachedData.playUrl && currentTime - cachedData.playUrl.timestamp < cacheDuration) {
      // 如果缓存存在且未过期，使用缓存的播放地址
      redirectUrl = cachedData.playUrl.url;
    } else {
      // 如果缓存不存在或已过期，重新获取播放地址
      // 请求参数
      let requestBody = {
        cityId: '5A',
        playId: channelId,
        relativeId: channelId,
        type: 1,
      };

      //计算签名
      let secretKey = 'aIErXY1rYjSpjQs7pq2Gp5P8k2W7P^Y@';
      let timestamp = new Date().getTime().toString();
      let signatureBody = {
        ...requestBody,
        appId: 'kdds-chongqingdemo',
        timestamps: timestamp,
      }

      let sortedSignatureKeys = Object.keys(signatureBody).sort();
      let stringToSign = secretKey + sortedSignatureKeys.map(key => `${key}${signatureBody[key]}`).join('');
      let signature = uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest({ name: 'MD5' }, TextEncoder().encode(stringToSign))));

      // 发起请求
      let playRequest = new Request(
        `https://portal.centre.live.cbncdn.cn/others/common/playUrlNoAuth?cityId=${requestBody.cityId}&playId=${requestBody.playId}&relativeId=${requestBody.relativeId}&type=${requestBody.type}`,
        {
          method: 'GET',
          headers: {
            'appId': signatureBody.appId,
            'timestamps': timestamp,
            'sign': signature,
          },
        }
      );

      let playResponse = await fetch(playRequest);

      // 写入KV存储
      cachedData.playUrl = {
        url: (await playResponse.json()).data.result.protocol[0].transcode[0].url,
        timestamp: currentTime,
      };

      if (cachedData.playUrl.url) {
        iptv_live_cqcb.put(cacheChannelId, JSON.stringify(cachedData));
      }

      redirectUrl = cachedData.playUrl.url;
    }
  } else {
    // 重庆以外地区
    if (cachedData.liveUrl && currentTime - cachedData.liveUrl.timestamp < cacheDuration) {
      // 如果缓存存在且未过期，使用缓存的直播地址
      redirectUrl = cachedData.liveUrl.url.replace(/^(https?:\/\/[^\/]+)/, (Math.random() > 0.5 ? 'http://cqcu6.live.cbncdn.cn' : 'http://cqcu7.live.cbncdn.cn'));
    } else {
      // 如果缓存不存在或已过期，重新获取直播地址
      let playRequest = new Request(
        `https://cq.cqcb.live.iptv.darwinchow.com/?channelId=${channelId}`,
        {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'X-Forwarded-For': request.eo.clientIp
          }
        }
      );
      let playResponse = await fetch(playRequest);

      let timestamp_lastmodified = new Date(playResponse.headers.get('Last-Modified')).getTime()

      // 写入KV存储
      cachedData.liveUrl = {
        url: playResponse.headers.get('Location'),
        timestamp: timestamp_lastmodified,
      };

      if (cachedData.liveUrl.url) {
        iptv_live_cqcb.put(cacheChannelId, JSON.stringify(cachedData));
      }

      redirectUrl = cachedData.liveUrl.url.replace(/^(https?:\/\/[^\/]+)/, (Math.random() > 0.5 ? 'http://cqcu6.live.cbncdn.cn' : 'http://cqcu7.live.cbncdn.cn'));
    }
  }

  return new Response(
    null,
    {
      status: 302,
      headers: {
        'Location': redirectUrl,
        'Content-Type': 'application/vnd.apple.mpegurl',
      },
    }
  );
}

function uint8ArrayToHex(arr) {
  return Array.prototype.map.call(arr, (x) => ((`0${x.toString(16)}`).slice(-2))).join('');
}
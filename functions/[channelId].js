export async function onRequest({ request, params, env }) {
  const geo = request.eo.geo;
  const channelId = params.channelId || 'cctv1HD';
  const cacheChannelId = channelId.toLowerCase();

  let redirectUrl = null;

  // Get the cached data from KV
  let cachedData = await iptv_live_cqcb.get(cacheChannelId, "json") || {};
  let currentTime = Date.now();
  let currentTimeString = currentTime.toString();

  if (geo.regionCode === 'CN-CQ') {
    if (cachedData.playUrl && currentTime - cachedData.playUrl.timestamp < env.CACHE_DURATION) {
      redirectUrl = cachedData.playUrl.url;
    } else {
      let requestBody = {
        cityId: '5A',
        playId: channelId,
        relativeId: channelId,
        type: 1,
      };

      let signatureBody = {
        ...requestBody,
        appId: 'kdds-chongqingdemo',
        timestamps: currentTimeString,
      }

      let sortedSignatureBodyKeys = Object.keys(signatureBody).sort();
      let signatureBodyString = atob(env.CBNAPI_SECRET_KEY) + sortedSignatureBodyKeys.map(key => `${key}${signatureBody[key]}`).join('');
      let signature = uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest({ name: 'MD5' }, TextEncoder().encode(signatureBodyString))));

      let playRequest = new Request(
        `https://portal.centre.live.cbncdn.cn/others/common/playUrlNoAuth?cityId=${requestBody.cityId}&playId=${requestBody.playId}&relativeId=${requestBody.relativeId}&type=${requestBody.type}`,
        {
          method: 'GET',
          headers: {
            'appId': signatureBody.appId,
            'timestamps': currentTimeString,
            'sign': signature,
          },
        }
      );

      let playResponse = await fetch(playRequest);

      if (playResponse.status === 200) {
        cachedData.playUrl = {
          url: (await playResponse.json()).data.result.protocol[0].transcode[0].url,
          timestamp: currentTime,
        };

        if (cachedData.playUrl.url) {
          iptv_live_cqcb.put(cacheChannelId, JSON.stringify(cachedData));
        }

        redirectUrl = cachedData.playUrl.url;
      } else {
        return errorResponse(playResponse.status, playResponse.statusText);
      }
    }
  } else {
    if (cachedData.liveUrl && currentTime - cachedData.liveUrl.timestamp < env.CACHE_DURATION) {
      redirectUrl = cachedData.liveUrl.url.replace(/^(https?:\/\/[^\/]+)/, (Math.random() > 0.5 ? 'http://cqcu6.live.cbncdn.cn' : 'http://cqcu7.live.cbncdn.cn'));
    } else {
      // Use Tencent Cloud EdgeOne Token Authentication Method V
      let requestSignatureBody = {
        KEY: env.REMOTEAPI_SECRET_KEY,
        Path: env.REMOTEAPI_URL.match(/^https?:\/\/[^/]+(\/[^?]*)?/)[1] || '/',
        t: Math.floor(currentTime / 1000).toString(16),
        whip: request.eo.clientIp,
      };
      let requestSignatureBodyString = Object.keys(requestSignatureBody).map(key => `${requestSignatureBody[key]}`).join('');
      let requestSignature = uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest({ name: 'SHA-1' }, TextEncoder().encode(requestSignatureBodyString))));

      let playRequest = new Request(
        env.REMOTEAPI_URL + `${channelId}&t=${requestSignatureBody.t}&sign=${requestSignature}`,
        {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'X-Forwarded-For': request.eo.clientIp,
          }
        }
      );
      let playResponse = await fetch(playRequest);

      if (playResponse.status === 302) {
        let timestamp_lastmodified = new Date(playResponse.headers.get('Last-Modified')).getTime()

        cachedData.liveUrl = {
          url: playResponse.headers.get('Location'),
          timestamp: timestamp_lastmodified,
        };

        if (cachedData.liveUrl.url) {
          iptv_live_cqcb.put(cacheChannelId, JSON.stringify(cachedData));
        }

        redirectUrl = cachedData.liveUrl.url.replace(/^(https?:\/\/[^\/]+)/, (Math.random() > 0.5 ? 'http://cqcu6.live.cbncdn.cn' : 'http://cqcu7.live.cbncdn.cn'));
      } else {
        return errorResponse(playResponse.status, playResponse.statusText);
      }
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

function errorResponse(statusCode, message) {
  return new Response(
    JSON.stringify({
      status: statusCode,
      message: message,
    }),
    {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

function uint8ArrayToHex(arr) {
  return Array.prototype.map.call(arr, (x) => ((`0${x.toString(16)}`).slice(-2))).join('');
}

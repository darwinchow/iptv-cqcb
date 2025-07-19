export async function onRequest({ request, params, env }) {
  const geo = request.eo.geo;
  const channelId = params.channelId || 'cctv1HD';
  const cacheChannelId = channelId.toLowerCase();

  let redirectUrl = null;

  // Get the cached data from KV
  let cachedData = await kv_iptv_cqcb.get(cacheChannelId, "json") || {};
  let cachedDataUpdatedTag = false;
  let currentTime = Date.now();
  let currentTimeString = currentTime.toString();

  if (geo.regionCode !== 'CN-CQ' && currentTime - cachedData.liveUrl?.timestamp < env.CACHE_DURATION) {
    redirectUrl = cachedData.liveUrl?.url.replace(/^(https?:\/\/[^\/]+)/, env.PROXYAPI_LIVE_URL);
  } else {
    if (!cachedData.playUrl || currentTime - cachedData.playUrl?.timestamp > env.CACHE_DURATION) {
      // Cache is expired, get new data
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
        env.CBNAPI_URL + '&' + new URLSearchParams(requestBody),
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

        cachedDataUpdatedTag = true;

      } else {
        return errorResponse(playResponse.status, playResponse.statusText);
      }
    }

    if (geo.regionCode === 'CN-CQ') {
      redirectUrl = cachedData.playUrl.url;
    } else {
      let playRequest = new Request(
        cachedData.playUrl.url.replace(/^(https?:\/\/[^\/]+)/, env.PROXYAPI_URL),
        {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'Access-Key': env.PROXYAPI_ACCESS_KEY,
          },
        }
      );
      let playResponse = await fetch(playRequest);

      if (playResponse.headers.has('Location')) {
        cachedData.liveUrl = {
          url: playResponse.headers.get('Location'),
          timestamp: cachedData.playUrl.timestamp,
        };

        cachedDataUpdatedTag = true;

        redirectUrl = cachedData.liveUrl.url.replace(/^(https?:\/\/[^\/]+)/, env.PROXYAPI_LIVE_URL);
      } else {
        return errorResponse(playResponse.status, playResponse.statusText);
      }
    }
  }

  if (cachedDataUpdatedTag) {
    await kv_iptv_cqcb.put(cacheChannelId, JSON.stringify(cachedData));
  }

  return new Response(
    null,
    {
      status: 302,
      headers: {
        'Location': redirectUrl,
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

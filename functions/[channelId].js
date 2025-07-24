export async function onRequest({ request, params, env }) {
  const geo = request.eo.geo;
  const channelId = params.channelId || 'cctv1HD';
  const cacheChannelId = channelId.toLowerCase();

  let redirectUrl = null;

  // Get the cache data from KV
  let cacheData = await kv_iptv_cqcb.get(cacheChannelId, "json") || {};
  let cacheDataUpdatedTag = false;
  let currentTime = Date.now();
  let currentTimeString = currentTime.toString();

  let liveUrlNoCqcu = getLiveUrl(cacheData.liveUrl, ['tencent', 'baidu'], currentTime);
  if (geo.regionCode !== 'CN-CQ' && liveUrlNoCqcu !== null) {
    redirectUrl = getProxyLiveUrl(liveUrlNoCqcu);
  } else {
    if (!cacheData.playUrl || currentTime > cacheData.playUrl?.expires) {
      // Cache is expired, get new data
      let requestBody = {
        cityId: '5A',
        playId: channelId,
        relativeId: channelId,
        type: '1',
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
        env.CBNAPI_URL + '?' + new URLSearchParams(requestBody).toString(),
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

      let playUrl = (await playResponse.json()).data?.result?.protocol[0]?.transcode[0]?.url;
      if (playUrl) {
        setPlayUrl(cacheData, playUrl);
        cacheDataUpdatedTag = true;
      } else {
        return errorResponse(playResponse.status, playResponse.statusText);
      }
    }

    if (geo.regionCode === 'CN-CQ') {
      redirectUrl = cacheData.playUrl.url;
    } else {
      let playRequest = new Request(
        getProxyPlayUrl(cacheData.playUrl.url),
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
        setLiveUrl(cacheData, playResponse.headers.get('Location'));
        cacheDataUpdatedTag = true;

        redirectUrl = getProxyLiveUrl(playResponse.headers.get('Location'));
      } else {
        return errorResponse(playResponse.status, playResponse.statusText);
      }
    }
  }

  if (cacheDataUpdatedTag) {
    await kv_iptv_cqcb.put(cacheChannelId, JSON.stringify(cacheData));
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

function setPlayUrl(cacheData, url) {
  let playUrlObject = new URL(url);
  cacheData.playUrl = {
    url: url,
    expires: Date.now() + 3600 * 1000,
    timestamp: Date.now(),
  };
}

function getProxyPlayUrl(url) {
  let playUrlObject = new URL(url);
  return playUrlObject.href.replace(playUrlObject.origin, env.PROXYAPI_URL);
}

function setLiveUrl(cacheData, url) {
  let liveUrlObject = new URL(url);

  if (!cacheData.liveUrl) {
    cacheData.liveUrl = {};
  }

  if (liveUrlObject.hostname.startsWith('tencent')) {
    cacheData.liveUrl.tencent = {
      url: url,
      expires: liveUrlObject.searchParams.get('t') * 1000 || Date.now() + 3600 * 1000,
      timestamp: Date.now(),
    };
  } else if (liveUrlObject.hostname.startsWith('baidu')) {
    cacheData.liveUrl.baidu = {
      url: url,
      expires: liveUrlObject.searchParams.get('timestamp') * 1000 || Date.now() + 3600 * 1000,
      timestamp: Date.now(),
    };
  } else if (liveUrlObject.hostname.startsWith('cqcu')) {
    cacheData.liveUrl.cqcu = {
      url: url,
      expires: Date.now() + 1800 * 1000,
      timestamp: Date.now(),
    };
  }
}

function getLiveUrl(liveUrlObject, sources = ['tencent', 'baidu', 'cqcu'], timestamp = Date.now()) {
  for (const source of sources) {
    if (timestamp < liveUrlObject?.[source]?.expires) {
      return liveUrlObject[source].url;
    }
  }
  return null;
}

function getProxyLiveUrl(liveUrl) {
  let liveUrlObject = new URL(liveUrl);
  let proxyLiveUrl = liveUrl;
  if (liveUrlObject.hostname.startsWith('tencent')) {
    proxyLiveUrl = liveUrlObject.href.replace(liveUrlObject.origin, env.PROXYAPI_LIVE_TENCENT_URL);
  } else if (liveUrlObject.hostname.startsWith('baidu')) {
    proxyLiveUrl = liveUrlObject.href.replace(liveUrlObject.origin, env.PROXYAPI_LIVE_BAIDU_URL);
  } else if (liveUrlObject.hostname.startsWith('cqcu')) {
    proxyLiveUrl = liveUrlObject.href.replace(liveUrlObject.origin, env.PROXYAPI_LIVE_CQCU_URL);
  }
  return proxyLiveUrl;
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

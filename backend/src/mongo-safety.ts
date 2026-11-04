const LOCAL_MONGO = /^mongodb:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|\?|$)/i;

export function isLocalMongoUri(uri: string): boolean {
  return LOCAL_MONGO.test(uri);
}

export function assertSafeMongoUri(uri?: string, allowRemote = process.env.ALLOW_REMOTE_DB === 'true') {
  if (uri && !isLocalMongoUri(uri) && !allowRemote) {
    throw new Error('Refusing a non-local MongoDB URI. Use a local database, or explicitly set ALLOW_REMOTE_DB=true.');
  }
}

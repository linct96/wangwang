export default {
  fetch(request: Request, env: { ASSETS: Fetcher }) {
    return env.ASSETS.fetch(request)
  },
}

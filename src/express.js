/* eslint-disable no-console */

const path = require('path')
const url = require('url')

const express = require('express') // eslint-disable-line import/no-unresolved
const helmet = require('helmet')

const { Provider } = require('oidc-provider')

const Account = require('./support/account')
const configuration = require('./support/configuration')
const routes = require('./routes/express')

const { PORT = 3000, ISSUER = `https://3981-79-237-48-100.eu.ngrok.io/auth` } =
  process.env
configuration.findAccount = Account.findAccount

const app = express()

const directives = helmet.contentSecurityPolicy.getDefaultDirectives()
delete directives['form-action']
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives,
    },
  })
)

app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

let server
;(async () => {
  let adapter = require('./adapters/redis')

  const prod = process.env.NODE_ENV === 'production'

  const provider = new Provider(ISSUER, { adapter, ...configuration })
  provider.proxy = true

  function handleClientAuthErrors(
    { headers: { authorization }, oidc: { body, client } },
    err
  ) {
    if (err.statusCode === 401 && err.message === 'invalid_client') {
      console.log(err)
      // save error details out-of-bands for the client developers, `authorization`, `body`, `client`
      // are just some details available, you can dig in ctx object for more.
    }
  }
  provider.on('grant.error', handleClientAuthErrors)
  provider.on('introspection.error', handleClientAuthErrors)
  provider.on('revocation.error', handleClientAuthErrors)

  if (prod) {
    app.enable('trust proxy')
    provider.proxy = true

    app.use((req, res, next) => {
      if (req.secure) {
        next()
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        res.redirect(
          url.format({
            protocol: 'https',
            host: req.get('host'),
            pathname: req.originalUrl,
          })
        )
      } else {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'do yourself a favor and only use https',
        })
      }
    })
  }

  routes(app, provider)
  app.use(provider.callback())
  server = app.listen(PORT, () => {
    console.log(
      `application is listening on port ${PORT}, check its /.well-known/openid-configuration`
    )
  })
})().catch((err) => {
  if (server && server.listening) server.close()
  console.error(err)
  process.exitCode = 1
})

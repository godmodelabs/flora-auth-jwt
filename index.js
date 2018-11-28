'use strict';

const jwt = require('jsonwebtoken');
const { AuthenticationError, RequestError } = require('flora-errors');

/**
 * @param {flora.Api} api - Api instance
 * @param {object} options - Plugin options
 * @param {string} options.secret - JWT secret
 * @param {boolean} [options.credentialsRequired] - Fail on requests without JWT (default: false)
 */
module.exports = (api, options) => {
    if (typeof options !== 'object') throw new Error('options must be an object');
    if (!options.secret) throw new Error('options must contain a "secret" property');

    options.credentialsRequired = !!options.credentialsRequired;

    api.on('request', async ({ request }) => {
        /**
         * Decode and verify JSON Web Token
         * @private
         */
        async function decode(token) {
            let decoded = null;
            if (token) {
                api.log.trace('Verifying JWT: ' + token);

                try {
                    decoded = jwt.verify(token, options.secret);
                } catch (err) {
                    api.log.trace(err);

                    if (err.message === 'jwt expired') {
                        const e = new AuthenticationError('Expired token received for JSON Web Token validation');
                        e.code = 'ERR_TOKEN_EXPIRED';
                        throw e;
                    }

                    const e = new AuthenticationError('Invalid signature received for JSON Web Token validation');
                    e.code = 'ERR_INVALID_TOKEN_SIGNATURE';
                    throw e;
                }

                api.log.trace('Verified authentication token: ', decoded);
            }

            const validated = typeof options.validate === 'function' ? await options.validate(decoded, request) : decoded;

            if (!request._auth) request._auth = validated;

            if (options.credentialsRequired && !request._auth) {
                const e = new AuthenticationError('No authorization token was found');
                e.code = 'ERR_MISSING_TOKEN';
                throw e;
            }
        }

        // already authenticated
        if (request._auth) return null;

        // request parameter "access_token" (POST, GET or native)
        if (request.access_token) {
            api.log.trace('Using access_token in request parameters: ' + request.access_token);
            return decode(request.access_token);
        }

        // HTTP "Authorization" header
        if (request._httpRequest && request._httpRequest.headers.authorization) {
            const parts = request._httpRequest.headers.authorization.split(' ');
            if (parts.length !== 2) throw new RequestError('Bad HTTP authentication header format');
            if (parts[0].toLowerCase() !== 'bearer') return null;
            if (parts[1].split('.').length !== 3) {
                throw new RequestError('Bad HTTP authentication header format');
            }

            api.log.trace('Using token from HTTP Authorization header: ' + parts[1]);
            return decode(parts[1]);
        }

        return decode(null);
    });
};

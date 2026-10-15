FROM node:24.20.0-alpine3.21

WORKDIR /app

COPY package.json package-lock.json ./
COPY index.html README.md ./
COPY .nvmrc ./
COPY css ./css
COPY js ./js
COPY assets ./assets
COPY tools/serve.mjs tools/validate.mjs ./tools/

RUN npm test

EXPOSE 8000

CMD ["node", "tools/serve.mjs", "8000"]

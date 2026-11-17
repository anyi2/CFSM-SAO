FROM node:22-alpine
ENV NODE_ENV=production\nENV HOST=0.0.0.0
WORKDIR /app
COPY package.json ./
COPY src ./src
EXPOSE 8787
USER node
CMD ["node", "src/server.mjs"]

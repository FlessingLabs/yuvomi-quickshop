# Gleiche Node-Linie wie Yuvomi (node:24-slim). Keine npm-Abhaengigkeiten:
# node:sqlite ist eingebaut.
FROM node:24-slim
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/extensions/flessinglabs-quickshop/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/main.js"]

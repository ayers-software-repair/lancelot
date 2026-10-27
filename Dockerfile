# The Lambda container image. Build dist first (the npm ci and build scripts), then:
#   docker buildx build --platform linux/arm64 --provenance=false -t lancelot-lambda .
# Base image and CMD form: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-image.html
# The AWS Node.js 24 base image is Amazon Linux 2023 and has a Lambda arm64 build.

# Production dependencies, installed on the target architecture. --ignore-scripts skips the
# keytar build, which needs the desktop keyring library; in Lambda the credential store falls
# back to its file under /tmp. The LanceDB native binary is a prebuilt package and needs no script.
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM --platform=linux/arm64 public.ecr.aws/lambda/nodejs:24
# package.json carries "type": "module", which makes dist/*.js load as ES modules.
COPY package.json ${LAMBDA_TASK_ROOT}/
COPY --from=deps /app/node_modules ${LAMBDA_TASK_ROOT}/node_modules
COPY dist ${LAMBDA_TASK_ROOT}/dist
# The file and the exported name, as the Handler setting: dist/lambda.js exports `handler`.
CMD [ "dist/lambda.handler" ]

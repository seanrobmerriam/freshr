---
description: "Deploy Fresh with Docker"
---

You can deploy Fresh to any platform that can run Docker containers. Docker is a
tool to containerize projects and portably run them on any supported platform.

When packaging your Fresh app for Docker, it is important that you set the
`FRESH_DEPLOYMENT_ID`
[environment variable](/docs/advanced/environment-variables) in your container.
This variable needs to be set to an opaque string ID that represents the version
of your application that is currently being run. This could be a Git commit
hash, or a hash of all files in your project. It is critical for the function of
Fresh that this ID changes when _any_ file in your project changes - if it
doesn't, incorrect caching **will** cause your project to not function
correctly.

Here is an example `Dockerfile` for a Fresh project:

```dockerfile Dockerfile
FROM oven/bun:1

ARG GIT_REVISION
ENV FRESH_DEPLOYMENT_ID=${GIT_REVISION}

WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

EXPOSE 8000

CMD ["bun", "_fresh/server.js"]
```

> [info]: The `bun install` step is required to populate `node_modules` before
> `bun run build`. `DENO_DEPLOYMENT_ID` is still read for compatibility.

To build your Docker image inside of a Git repository:

```sh Terminal
$ docker build --build-arg GIT_REVISION=$(git rev-parse HEAD) -t my-fresh-app .
```

Then run your Docker container:

```sh Terminal
$ docker run -t -i -p 80:8000 my-fresh-app
```

To deploy to a cloud provider, push it to a container registry and follow their
documentation.

- [Amazon Web Services](https://docs.aws.amazon.com/AmazonECS/latest/userguide/create-container-image.html#create-container-image-push-ecr)
- [Google Cloud](https://cloud.google.com/container-registry/docs/pushing-and-pulling)

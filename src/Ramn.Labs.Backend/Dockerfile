# Build
FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build-env
WORKDIR /src

# Copy project files first to leverage Docker layer caching.
COPY ["Ramn.Labs.Backend/Ramn.Labs.Backend.csproj", "Ramn.Labs.Backend/"]
COPY ["Ramn.Labs.Frontend/Ramn.Labs.Frontend.csproj", "Ramn.Labs.Frontend/"]
RUN dotnet restore "Ramn.Labs.Backend/Ramn.Labs.Backend.csproj"

# Copy the remaining source and publish backend.
COPY . .
RUN dotnet publish "Ramn.Labs.Backend/Ramn.Labs.Backend.csproj" -c Release -o /app/out

# Runtime
FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
ENV DOTNET_RUNNING_IN_CONTAINER=true
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false
RUN apk add --no-cache icu-libs
WORKDIR /app
COPY --from=build-env /app/out .
ENV ASPNETCORE_URLS=http://+:5001
EXPOSE 5001
ENTRYPOINT ["dotnet", "Ramn.Labs.Backend.dll"]

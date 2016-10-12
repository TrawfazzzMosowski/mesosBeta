## Installation
None.

### Requirements
1. *_Java 8_*

## Configuration
See comments in config files
- `logback.xml`
- `mesos.excludes` This is a raw file (not a properties file so no # comment tags) containing Java regular expressions. If a metric line matches any one of these regex's then it is excluded from the process
- `mesosMetrics.properties` Maps Mesos/Marathon metrics to New Relic metrics
- `newrelic.json` standard plugin config
- `plugin.json` *per agent* configuration. 
  - `name` must be unique
  - `type` defines the endpoint under monitor
    - com.newrelic.fit.mesos.monitors.Marathon
    - com.newrelic.fit.mesos.monitors.MesosMaster
    - com.newrelic.fit.mesos.monitors.MesosAgent
  - `url` is the full url including port of the monitored endpoint
  - `excludesFile` can be empty (nothing excluded), shared, or unique to the agent
- `shared.properties` properties common to all agents. Insights URL and key go here

## Execution
1. Ensure all config files are in the `config` directory
2. Execute the jar
```shell
java -Dlogback.configurationFile=config/logback.xml -jar mesos-plugin-1.0.0-SNAPSHOT.jar
```

### Dire Warnings
- `name` in `config/plugin.json` *must be unique* in the file
#!/bin/bash

read -r -d '' SETTINGS_GRADLE_CONTENT_LOCAL <<EOF
includeBuild('/usr/src/rskj') {
   dependencySubstitution {
        all { DependencySubstitution dependency ->
           if (dependency.requested instanceof ModuleComponentSelector
                  && dependency.requested.group == 'co.rsk'
                  && dependency.requested.module == 'rskj-core'
                  && (dependency.requested.version.endsWith('SNAPSHOT') || dependency.requested.version.endsWith('RC'))) {
              def targetProject = project(":\${dependency.requested.module}")
               if (targetProject != null) {
                  println('---- USING LOCAL ' + dependency.requested.displayName + ' PROJECT ----')
                  dependency.useTarget targetProject
               }
          }
        }
   }
}
EOF

# Read the version.properties from federator file
while IFS='=' read -r key value
do
    # Remove all spaces
    key=$(echo $key | tr -d ' ')
    value=$(echo $value | tr -d ' ')

    # Check if key is 'modifier' or 'versionNumber'
    if [[ "$key" == "modifier" ]]; then
        modifier=${value//\"/}
    elif [[ "$key" == "versionNumber" ]]; then
        versionNumber=${value//\'/}
    fi
done < "src/main/resources/version.properties"

# Concatenate modifier and versionNumber
FED_VERSION="$modifier-$versionNumber"
echo "$FED_VERSION"
if [[ $FED_VERSION == SNAPSHOT* || $FED_VERSION == RC* ]]; then
  echo -e "$SETTINGS_GRADLE_CONTENT_LOCAL" > DONT-COMMIT-settings.gradle
fi
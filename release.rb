version = ARGV.first
Dir.chdir "../"
puts `zip -r Flipper@connerdev_#{version}.zip Flipper@connerdev/extension.js Flipper@connerdev/metadata.json Flipper@connerdev/settings-schema.json`

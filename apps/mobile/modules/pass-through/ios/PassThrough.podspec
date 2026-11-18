Pod::Spec.new do |s|
  s.name           = 'PassThrough'
  s.version        = '0.1.0'
  s.summary        = 'A view the tvOS focus engine looks straight through.'
  s.author         = ''
  s.homepage       = 'https://github.com/mutaaf/18-0'
  s.license        = 'UNLICENSED'
  # tvOS is the point. iOS so that a phone build of the same project links it
  # (and never mounts it: index.ts hands it out on a TV only).
  s.platforms      = { :ios => '16.4', :tvos => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end

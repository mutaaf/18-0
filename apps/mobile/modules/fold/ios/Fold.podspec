Pod::Spec.new do |s|
  s.name           = 'Fold'
  s.version        = '0.1.0'
  s.summary        = 'Reports the iPhone Duo fold and hinge to JavaScript.'
  s.author         = ''
  s.homepage       = 'https://github.com/mutaaf/18-0'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end

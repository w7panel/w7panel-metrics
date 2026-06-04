.PHONY: upgrade
release:
	helm package ./charts/w7panel-metrics
upgrade:
	helm upgrade w7panel-metrics ./charts/w7panel-metrics
downZpk:
	wget https://gh-proxy.org/https://github.com/w7panel/w7panel-zpk/releases/download/latest/w7-zpk_linux_amd64 -O /tmp/zpk 
	chmod +x /tmp/zpk
	sudo mv /tmp/zpk /usr/local/bin/
login:
	zpk login --username=w7admin --password=${PASSWORD} --host=zpk.w7.cc
publish:
	zpk use --name=w7panel-metrics
	zpk attach add --path=./w7panel-metrics-1.0.23.tgz --type=helm
	zpk push

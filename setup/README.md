# Setup with an Ansible Playbook

This is a way to setup Sherlock in you Azure subscription, through an Ansible playbook

## Variables

1. Copy the sample vars file: `$ cp setup/vars.yml.sample setup/vars.yml`
1. Add the necessary values into the new `vars.yml` file

## Azure CLI

At the moment, this playbook requires the Azure CLI to be on localhost. To install the Azure CLI you can do the following:

1. Install the Azure CLI (if you don't already have it): `$ curl -L https://aka.ms/InstallAzureCli | bash`
1. Login to your subscription: `$ az login`

:bulb: If you have multiple subscriptions (viewable through `az account list`) ensure that your desired target subscription is the default:

1. List all registered subscriptions: `$ az account list --query "[*].{name: name, id: id, isDefault: isDefault}"`
1. If your target subscription isn't currently default, set it: `$ az account set -s <subscription_id>`

:bulb: Because this playbook currently relies on a shell program, it is not idempotent at the moment (this will be changed when there is Ansible functionality for Azure Functions (coming soon))

## Run the playbook

```
$ ansible-playbook main.yml
```

## Get the Azure Function URL and key

Navigate to the [Azure Porta](https://portal.azure.com) to retrieve the Function URL and key(s)

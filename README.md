# Sherlock

*Integration testing sandbox provisioning tool for Microsoft Azure*

## Index

- [Overview](#overview)
- [Setup with Ansible](#setup-with-ansible)
- [Setup manually](#setup-manually)
- [Usage](#usage)

## Overview

**What does Sherlock provide for me?**

Sherlock will create one or more resource groups in a subscription, and create a corresponding service principal that has rights *only* in that/those resource group(s). There is also a cleanup process that will routinely run to delete resource groups and service principals from past integration test runs. In essence, this is a turn-key solution that requires no administration overhead for an integration testing environment.

**What is Sherlock built with?**

This tool is an Azure Function app, with two functions: the first one is a web API that listens for requests to create a sandbox environment (and respond with the necessary connection information). The second Function is a cleanup process that is the cron job to remove sandbox environments in the subscription when they expire.

## Setup with Ansible

[Ansible playbook setup guide](setup/)

## Setup Manually

To quickly and easily standup Sherlock in your Azure Subscription, I highly recommend you use the [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli). The following steps assume that you have the Azure CLI installed and logged in for your subscription.

1. Fork [this repository](https://github.com/tstringer/sherlock) into your GitHub account. I *highly* recommend that you fork this repository into your own GitHub account. I will continue active development on Sherlock and in order to ensure I don't introduce breaking changes into your integration testing environment, you should have a downstream fork so you can pick and choose when you merge updates (fixes, etc.)
1. Create a resource group for Sherlock: `$ az group create -n sherlock-rg -l eastus`
1. Create a storage account: `$ az storage account create -g sherlock-rg -n sherlockstor -l eastus --sku Standard_LRS`
1. Create the Azure Function App: `$ az functionapp create -g sherlock-rg -n sherlockinttest -s sherlockstor -u https://github.com/tstringer/sherlock.git --consumption-plan-location eastus` (you will need to create a unique name for your Function App)
1. Configure Sherlock (see the [Configuration section](#configuration) below)

### Configuration

1. Set the client ID app setting for Sherlock: `$ az functionapp config appsettings set -g sherlock-rg -n sherlockinttest --settings AZURE_CLIENT_ID=<service_principal_app_id>` (this is going to be the service principal application ID that you have to prestage in your Azure AD tenant)
1. Set the client secret for Sherlock: `$ az functionapp config appsettings set -g sherlock-rg -n sherlockinttest --settings AZURE_CLIENT_SECRET=<service_principal_key>`
1. Set the subscription ID: `$ az functionapp config appsettings set -g sherlock-rg -n sherlockinttest --settings AZURE_SUBSCRIPTION_ID=<subscription_id>`
1. Set the tenant ID for your Azure AD: `$ az functionapp config appsettings set -g sherlock-rg -n sherlockinttest --settings AZURE_TENANT_ID=<tenant_id>`
1. Set the prefix for Sherlock: `$ az functionapp config appsettings set -g sherlock-rg -n sherlockinttest --settings RES_PREFIX=sherlock` (this will be the prefix that is used to name provisioned resource groups and service principals)

## Queue Setup and Configuration

Sherlock utilizes queueing for pooling identities. This queue is provided by Azure Storage, and therefore you need to setup the account prior to using Sherlock.

1. Create a general purpose storage account in an Azure subscription
1. On the Sherlock Function App, set the following environment variables:
  - SHERLOCK_IDENTITY_STORAGE_ACCOUNT - set this to the Azure storage account
  - SHERLOCK_IDENTITY_STORAGE_KEY - set this to the storage key

:bulb: Note, you don't have to prestage the queue. The `identity-manager` Function will create it if it doesn't already exist

## Usage

Once you have Sherlock setup and configured (see above), you only need to make a POST request to Sherlock. The request will look like: `https://<function_app_name>.azurewebsites.net/api/sandbox-provisioning?code=<key>`, where `function_app_name` is the name of the Azure Function App you used when you created it above (in my case, I used `sherlockinttest` but you would have a different name).

The `key` is either the existing Function key that was created with the Azure Function was created, or a newly generated key (it is recommended to create a new key for each user and integration testing framework so that it is a more secure implementation, allowing you to revoke a key without affecting more users/clients). To create a new key you will have to use the Azure Portal. Navigate to the portal, and go to your Azure Function. Click on the **Manage** section for the `sandbox-provisioning` Function. Here you can view existing keys as well as create new keys.

**Request parameters**

- *rgcount*: the amount of resource groups that need to be created (default **1**)
- *region*: the location to create the resource groups in (default **eastus**)
- *duration*: amount of time (in minutes) that the resource group (and corresponding principal) needs to be preserved for (default **30 minutes**). After this elapsed time, the cleanup Function will delete the resource groups and any resources in the resource group(s)

**Examples**

- Create a single resource group in East US that should live for 30 minutes: `$ curl "https://<function_app_name>.azurewebsites.net/api/sandbox-provisioning?code=<key>"`
- Create two resource groups in West US that should live for 2 hours: `$ curl "https://<function_app_name>.azurewebsites.net/api/sandbox-provisioning?code=<key>&region=westus&duration=120&rgcount=2"`

**Response**

Sherlock, if successfully run, will respond with the following:

- *resourceGroupNames*: an array of the name(s) of the resource group(s) that were created
- *clientId*: the ID of the service principal that was created
- *clientSecret*: the secret/password of the service principal that was created
- *subscriptionId*: the subscription ID for the current Azure subscription
- *tenantId*: the tenant ID of the current Azure AD tenant

import requests

url = "https://places-api.foursquare.com/places/4b3a2309f964a520806125e3/photos"

headers = {
    "X-Places-Api-Version": "2025-06-17",
    "accept": "application/json",
    "authorization": "Bearer APB0F410P33N2CVHZB5JSXZ2QXTLMXRS4DVPM20F23QYBMYM"
}

response = requests.get(url, headers=headers)

print(response.text)
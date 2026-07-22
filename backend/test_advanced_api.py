"""
Test script for advanced analysis API endpoints
Run this after starting the Flask backend
"""

import requests
import json
from pprint import pprint

BASE_URL = "http://localhost:5000"

# Simple test graph
test_data = {
    "nodes": [
        {
            "name": "asset prices",
            "start_amount": 0.1,
            "retention": 0.3,
            "floor": -999999,
            "ceiling": 999999
        },
        {
            "name": "credit risk",
            "start_amount": 0.1,
            "retention": 0.3,
            "floor": -999999,
            "ceiling": 999999
        },
        {
            "name": "capital",
            "start_amount": 0.1,
            "retention": 0.3,
            "floor": -999999,
            "ceiling": 999999
        }
    ],
    "edges": [
        {
            "source": "asset prices",
            "target": "credit risk",
            "correlation": -0.45,
            "decay": 0.165,
            "delay": 4,
            "confidence": 0.8
        },
        {
            "source": "credit risk",
            "target": "asset prices",
            "correlation": -0.45,
            "decay": 0.165,
            "delay": 4,
            "confidence": 0.8
        },
        {
            "source": "credit risk",
            "target": "capital",
            "correlation": -0.55,
            "decay": 0.165,
            "delay": 4,
            "confidence": 0.8
        }
    ],
    "iterations": 100
}


def test_advanced_simulation():
    """Test the advanced simulation endpoint"""
    print("\n" + "="*60)
    print("Testing /simulation/two-phase endpoint")
    print("="*60)
    
    try:
        response = requests.post(
            f"{BASE_URL}/simulation/two-phase",
            json=test_data,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Success!")
            print(f"\nClassifications:")
            for node, classification in result['classifications'].items():
                print(f"  - {node}: {classification}")
            
            print(f"\nTime series data keys: {list(result['time_series_data'].keys())}")
            print(f"Time series length: {len(result['time_series_data']['asset prices'])} steps")
            
            print(f"\nPlots generated:")
            for plot_name, plot_data in result['plots'].items():
                print(f"  - {plot_name}: {len(plot_data)} bytes (base64)")
            
            return True
        else:
            print(f"❌ Error: {response.status_code}")
            print(response.text)
            return False
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection Error: Is the Flask backend running?")
        print("   Run: cd backend && python app.py")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_stability_map():
    """Test the stability map endpoint"""
    print("\n" + "="*60)
    print("Testing /parameter-maps/stability-sweep endpoint")
    print("="*60)
    print("Note: This may take 30-60 seconds...")
    
    stability_data = {
        **test_data,
        "decay_range": [0.0, 0.5, 6],  # Smaller grid for faster testing
        "delay_range": [0, 5, 6],
        "iterations": 50  # Fewer iterations for speed
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/parameter-maps/stability-sweep",
            json=stability_data,
            timeout=120
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Success!")
            print(f"\nDecay values: {result['decay_values']}")
            print(f"Delay values: {result['delay_values']}")
            print(f"Stability matrix shape: {len(result['stability_matrix'])}×{len(result['stability_matrix'][0])}")
            print(f"Plot generated: {len(result['plot'])} bytes (base64)")
            return True
        else:
            print(f"❌ Error: {response.status_code}")
            print(response.text)
            return False
            
    except requests.exceptions.Timeout:
        print("❌ Timeout: Analysis took too long")
        print("   Try reducing iterations or grid size")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_original_endpoint():
    """Test an original endpoint for comparison"""
    print("\n" + "="*60)
    print("Testing original /graph/feedback-cycles endpoint (for comparison)")
    print("="*60)
    
    original_data = {
        "edges": [
            ["asset prices", "credit risk"],
            ["credit risk", "asset prices"],
            ["credit risk", "capital"]
        ],
        "edge_polarities": [-1, -1, -1]
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/graph/feedback-cycles",
            json=original_data,
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Success!")
            print("Original endpoint still working")
            return True
        else:
            print(f"❌ Error: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


if __name__ == "__main__":
    print("\n" + "#"*60)
    print("# Advanced Analysis API Test Suite")
    print("#"*60)
    
    results = []
    
    # Run tests
    results.append(("Advanced Simulation", test_advanced_simulation()))
    results.append(("Stability Map", test_stability_map()))
    results.append(("Original Endpoint", test_original_endpoint()))
    
    # Summary
    print("\n" + "#"*60)
    print("# Test Summary")
    print("#"*60)
    
    for test_name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    total = len(results)
    passed = sum(1 for _, p in results if p)
    print(f"\n{passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed! Your advanced API is ready to use.")
    else:
        print("\n⚠️  Some tests failed. Check the errors above.")


